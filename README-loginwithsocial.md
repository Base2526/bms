# Social Login

The authoritative implementation is:

- `apps/web/lib/auth/social.ts` for provider-token verification.
- `apps/web/graphql/resolvers.ts` (`loginWithSocial`) for canonical account lookup/create and JWT issuance.
- `apps/web/lib/auth/identity.ts` for email normalization and validation.
- `docs/architecture/api.md` for the complete authentication contract.

Do not copy old decode-only JWT examples into this project. A Google credential must be verified by
`google-auth-library.verifyIdToken()` using `NEXT_PUBLIC_GOOGLE_CLIENT_ID` as the audience, and the
payload must include a subject and verified email. Decoding the payload without checking signature,
issuer, expiry, and audience permits account takeover.

Facebook login must validate the access token through Graph API `debug_token`, require the returned
`app_id` to match `NEXT_PUBLIC_FACEBOOK_APP_ID`, require `/me.id` to match `debug_token.user_id`, and
require an email. `FACEBOOK_APP_SECRET` is server-only. Compose temporarily accepts
`NEXT_PUBLIC_FACEBOOK_APP_SECRET` only as a source-value fallback for migration, but it injects the
secret into the app under the private `FACEBOOK_APP_SECRET` name.

Both providers use normalized lowercase email identity and the database uniqueness guarantees from
`7.75__users_case_insensitive_identity.sql`. Concurrent first-login requests must converge on one
user; provider tokens, raw email addresses, and profile payloads must not be logged.

Social login returns the normal 7-day `USER_COOKIE`/JWT session. Community sessions remain stateless
and are not covered by Redis admin-session revocation yet.
