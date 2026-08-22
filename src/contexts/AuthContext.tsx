import { createContext, useContext, useEffect, useState, useCallback, useMemo, useRef, ReactNode } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';

interface UserProfile {
  id: string;
  email: string;
  full_name?: string;
  role?: string;
  created_at?: string;
}

interface AuthContextType {
  user: User | null;
  session: Session | null;
  profile: UserProfile | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signUp: (email: string, password: string, fullName?: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<{ error: Error | null }>;
  updateProfile: (updates: Partial<UserProfile>) => Promise<{ error: Error | null }>;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Supabase delivers a freshly-deserialized `User` object on every auth event,
// including a plain TOKEN_REFRESHED where nothing about the user actually
// changed. Comparing by identity (rather than switching on the event name)
// means every consumer with `user` in a dependency array -- SurveyDesignerPage
// among them -- stops re-running on a routine hourly token refresh, without
// having to enumerate which future event names are "safe".
const sameUser = (a: User | null, b: User | null): boolean =>
  a === b || (a?.id === b?.id && a?.updated_at === b?.updated_at);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  // Fetch user profile from database
  const fetchProfile = async (userId: string) => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .maybeSingle();

      if (error) {
        console.error('Error fetching profile:', error);
        return null;
      }
      return data as UserProfile | null;
    } catch (err) {
      console.error('Unexpected error fetching profile:', err);
      return null;
    }
  };

  // Tracks which user's profile is currently loaded, so a token refresh for
  // the same user doesn't re-fetch and re-set (and thus re-identity-churn)
  // the profile on every ticker firing.
  const profileUserIdRef = useRef<string | null>(null);

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false); // Set loading false immediately, fetch profile in background

      if (session?.user) {
        profileUserIdRef.current = session.user.id;
        fetchProfile(session.user.id).then(setProfile);
      }
    });

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        // `session` itself legitimately changes on every refresh (new access
        // token) and downstream code reads it for that token, so it is
        // always applied. `user` is compared by identity so a routine
        // refresh does not ripple into every `[..., user]` dependency array
        // in the app.
        setSession(session);
        setUser(prev => (sameUser(prev, session?.user ?? null) ? prev : session?.user ?? null));
        setLoading(false); // Set loading false immediately

        if (session?.user) {
          if (profileUserIdRef.current !== session.user.id) {
            profileUserIdRef.current = session.user.id;
            // Fetch profile in background, don't block
            fetchProfile(session.user.id).then(setProfile);
          }
        } else {
          profileUserIdRef.current = null;
          setProfile(null);
        }
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      return { error: error as Error | null };
    } catch (err) {
      console.error('Sign in exception:', err);
      return { error: err as Error };
    }
  }, []);

  const signUp = useCallback(async (email: string, password: string, fullName?: string) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName,
        },
      },
    });

    // Create profile entry after signup
    if (!error && data.user) {
      await supabase.from('profiles').upsert({
        id: data.user.id,
        email: email,
        full_name: fullName,
        created_at: new Date().toISOString(),
      });
    }

    return { error: error as Error | null };
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setUser(null);
    setSession(null);
    setProfile(null);
    profileUserIdRef.current = null;
  }, []);

  const resetPassword = useCallback(async (email: string) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    return { error: error as Error | null };
  }, []);

  const updateProfile = useCallback(async (updates: Partial<UserProfile>) => {
    if (!user) {
      return { error: new Error('No user logged in') };
    }

    const { error } = await supabase
      .from('profiles')
      .update({
        ...updates,
        updated_at: new Date().toISOString(),
      })
      .eq('id', user.id);

    if (!error) {
      setProfile(prev => prev ? { ...prev, ...updates } : null);
    }

    return { error: error as Error | null };
  }, [user]);

  const value = useMemo<AuthContextType>(() => ({
    user,
    session,
    profile,
    loading,
    signIn,
    signUp,
    signOut,
    resetPassword,
    updateProfile,
  }), [user, session, profile, loading, signIn, signUp, signOut, resetPassword, updateProfile]);

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
