/**
 * The portal's release version and the commit it was built from.
 *
 * The version is package.json's, bumped at each release with a matching
 * CHANGELOG.md entry and a `web-vX.Y.Z` tag (SOP-002). Between releases the
 * version stays the same while the commit moves, which is why both are shown:
 * the version says which release, the commit says exactly which build.
 */
export const APP_VERSION: string = __APP_VERSION__;
export const APP_COMMIT: string = __APP_COMMIT__;

/** The first 7 characters of the commit, as git abbreviates it. */
export const APP_COMMIT_SHORT: string = APP_COMMIT === 'unknown' ? APP_COMMIT : APP_COMMIT.slice(0, 7);
