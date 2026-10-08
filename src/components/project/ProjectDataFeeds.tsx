import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Copy, KeyRound, Loader2, Plus } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/hooks/use-toast";
import { getErrorMessage } from "@/lib/errors/getErrorMessage";
import { HelpLink } from "@/components/docs/HelpLink";
import { feedKeyService, feedUrl, type FeedKey, type NewFeedKey } from "@/services/feedKeyService";

interface ProjectDataFeedsProps {
  projectId: string;
  /** Owners create and revoke; admins can see the list. */
  isOwner: boolean;
}

function keyState(key: FeedKey): { label: string; variant: "default" | "secondary" | "destructive" } {
  if (key.revoked_at) return { label: "Revoked", variant: "destructive" };
  if (key.expires_at && new Date(key.expires_at) <= new Date()) return { label: "Expired", variant: "secondary" };
  return { label: "Active", variant: "default" };
}

function formatWhen(value: string | null): string {
  return value ? format(new Date(value), "yyyy-MM-dd HH:mm") : "Never";
}

/**
 * Data feed keys: read-only, project-scoped bearer keys for dashboards and
 * scheduled analysis, served by the project-data-feed Edge Function. See
 * migration 20261008090000 and the "Data feeds" docs section.
 */
const ProjectDataFeeds = ({ projectId, isOwner }: ProjectDataFeedsProps) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const keysQuery = useQuery({
    queryKey: ["project-feed-keys", projectId],
    queryFn: () => feedKeyService.listKeys(projectId),
  });

  const surveysQuery = useQuery({
    queryKey: ["project-survey-codes", projectId],
    enabled: isOwner,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("survey_packages")
        .select("survey_code, display_name, version")
        .eq("project_id", projectId)
        .order("version", { ascending: false });
      if (error) throw error;
      // One entry per survey (every version shares a survey_code), named
      // after its newest version.
      const byCode = new Map<string, string>();
      for (const row of data ?? []) {
        if (!byCode.has(row.survey_code)) byCode.set(row.survey_code, row.display_name);
      }
      return [...byCode.entries()].map(([code, name]) => ({ code, name }));
    },
  });

  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [surveyCodes, setSurveyCodes] = useState<string[]>([]);
  const [includeTest, setIncludeTest] = useState(false);
  const [expiresOn, setExpiresOn] = useState("");
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<NewFeedKey | null>(null);

  const [revoking, setRevoking] = useState<FeedKey | null>(null);
  const [revokeReason, setRevokeReason] = useState("");
  const [revokeSaving, setRevokeSaving] = useState(false);

  const resetCreate = () => {
    setName("");
    setSurveyCodes([]);
    setIncludeTest(false);
    setExpiresOn("");
    setCreated(null);
  };

  const handleCreate = async () => {
    if (!name.trim()) return;
    setCreating(true);
    try {
      const result = await feedKeyService.createKey(projectId, {
        name: name.trim(),
        surveyCodes: surveyCodes.length > 0 ? surveyCodes : null,
        includeTest,
        // End of the chosen day, local time.
        expiresAt: expiresOn ? new Date(`${expiresOn}T23:59:59`).toISOString() : null,
      });
      setCreated(result);
      await queryClient.invalidateQueries({ queryKey: ["project-feed-keys", projectId] });
    } catch (error) {
      toast({ title: "Key not created", description: getErrorMessage(error, "The key could not be created."), variant: "destructive" });
    } finally {
      setCreating(false);
    }
  };

  const handleRevoke = async () => {
    if (!revoking || !revokeReason.trim()) return;
    setRevokeSaving(true);
    try {
      await feedKeyService.revokeKey(revoking.id, revokeReason.trim());
      await queryClient.invalidateQueries({ queryKey: ["project-feed-keys", projectId] });
      toast({ title: "Key revoked", description: "Anything using this key loses access on its next request." });
      setRevoking(null);
      setRevokeReason("");
    } catch (error) {
      toast({ title: "Revoke failed", description: getErrorMessage(error, "The key could not be revoked."), variant: "destructive" });
    } finally {
      setRevokeSaving(false);
    }
  };

  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: `${what} copied` });
    } catch {
      toast({ title: "Copy failed", description: "Select the text and copy it manually.", variant: "destructive" });
    }
  };

  const surveyName = (code: string) => surveysQuery.data?.find((s) => s.code === code)?.name ?? code;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <KeyRound className="h-5 w-5 text-muted-foreground" />
            <CardTitle>Data feeds</CardTitle>
            <HelpLink slug="data-feeds/overview" />
          </div>
          {isOwner && (
            <Button size="sm" onClick={() => { resetCreate(); setCreateOpen(true); }}>
              <Plus className="mr-1 h-4 w-4" /> Create key
            </Button>
          )}
        </div>
        <CardDescription>
          Read-only keys that let a dashboard or script read this project's data automatically. A key can only ever
          read this project.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1">
          <Label>Feed URL</Label>
          <div className="flex gap-2">
            <Input readOnly value={feedUrl()} className="bg-muted font-mono text-xs" />
            <Button variant="outline" size="icon" aria-label="Copy feed URL" onClick={() => copy(feedUrl(), "Feed URL")}>
              <Copy className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {keysQuery.isPending ? (
          <p className="text-sm text-muted-foreground">Loading keys…</p>
        ) : keysQuery.isError ? (
          <p className="text-sm text-destructive">The keys could not be loaded.</p>
        ) : keysQuery.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">No keys yet.</p>
        ) : (
          <ul className="divide-y rounded-md border">
            {keysQuery.data.map((key) => {
              const state = keyState(key);
              return (
                <li key={key.id} className="flex flex-wrap items-start justify-between gap-3 p-3 text-sm">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{key.name}</span>
                      <Badge variant={state.variant}>{state.label}</Badge>
                    </div>
                    <p className="font-mono text-xs text-muted-foreground">dkf_{key.key_prefix}_…</p>
                    <p className="text-xs text-muted-foreground">
                      {key.survey_codes ? key.survey_codes.map(surveyName).join(", ") : "All surveys"}
                      {" · "}
                      {key.data_statuses.includes("test") ? "deployed and test data" : "deployed data only"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Created {formatWhen(key.created_at)} · Last used {formatWhen(key.last_used_at)}
                      {key.expires_at && ` · Expires ${formatWhen(key.expires_at)}`}
                    </p>
                    {key.revoked_at && (
                      <p className="text-xs text-muted-foreground">
                        Revoked {formatWhen(key.revoked_at)}: {key.revoke_reason}
                      </p>
                    )}
                  </div>
                  {isOwner && !key.revoked_at && (
                    <Button variant="outline" size="sm" onClick={() => { setRevoking(key); setRevokeReason(""); }}>
                      Revoke
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>

      {/* Create, then show the key once. */}
      <Dialog open={createOpen} onOpenChange={(open) => { setCreateOpen(open); if (!open) resetCreate(); }}>
        <DialogContent>
          {created ? (
            <>
              <DialogHeader>
                <DialogTitle>Copy your key now</DialogTitle>
                <DialogDescription>
                  This is the only time the key is shown. Store it as a secret (for example with{" "}
                  <code>supabase secrets set</code>). Never put it in Git or browser code.
                </DialogDescription>
              </DialogHeader>
              <div className="flex gap-2">
                <Input readOnly value={created.key} className="font-mono text-xs" onFocus={(e) => e.target.select()} />
                <Button variant="outline" size="icon" aria-label="Copy key" onClick={() => copy(created.key, "Key")}>
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
              <DialogFooter>
                <Button onClick={() => { setCreateOpen(false); resetCreate(); }}>Done</Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>Create a data feed key</DialogTitle>
                <DialogDescription>The key will be able to read this project's data, and nothing else.</DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="feed-key-name">Name</Label>
                  <Input
                    id="feed-key-name"
                    value={name}
                    maxLength={100}
                    placeholder="e.g. Project dashboard"
                    onChange={(e) => setName(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Surveys</Label>
                  <p className="text-xs text-muted-foreground">Leave all unticked to allow every survey in the project.</p>
                  {surveysQuery.data?.length === 0 && <p className="text-xs text-muted-foreground">No surveys yet.</p>}
                  {surveysQuery.data?.map((survey) => (
                    <label key={survey.code} className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={surveyCodes.includes(survey.code)}
                        onCheckedChange={(checked) =>
                          setSurveyCodes((prev) =>
                            checked ? [...prev, survey.code] : prev.filter((c) => c !== survey.code))}
                      />
                      {survey.name} <span className="font-mono text-xs text-muted-foreground">{survey.code}</span>
                    </label>
                  ))}
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={includeTest} onCheckedChange={(checked) => setIncludeTest(checked === true)} />
                  Also include test data
                </label>
                <div className="space-y-2">
                  <Label htmlFor="feed-key-expiry">Expires on (optional)</Label>
                  <Input id="feed-key-expiry" type="date" value={expiresOn} onChange={(e) => setExpiresOn(e.target.value)} />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
                <Button onClick={handleCreate} disabled={creating || !name.trim()}>
                  {creating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Create key
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!revoking} onOpenChange={(open) => { if (!open) setRevoking(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Revoke “{revoking?.name}”?</DialogTitle>
            <DialogDescription>
              Anything using this key stops receiving data on its next request. This cannot be undone; create a new
              key if access is needed again.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="feed-key-revoke-reason">Reason</Label>
            <Textarea id="feed-key-revoke-reason" value={revokeReason} onChange={(e) => setRevokeReason(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRevoking(null)}>Cancel</Button>
            <Button variant="destructive" onClick={handleRevoke} disabled={revokeSaving || !revokeReason.trim()}>
              {revokeSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Revoke key
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
};

export default ProjectDataFeeds;
