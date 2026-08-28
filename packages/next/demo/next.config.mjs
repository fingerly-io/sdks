/**
 * The demo app.
 *
 * `transpilePackages` because the binding is consumed from its TypeScript
 * source rather than from `dist`: the point of this app is to exercise the
 * code in `src/`, and Next has to compile it the way it compiles the app's own
 * files.
 */
export default {
  transpilePackages: ['@badele/next', '@badele/react', '@badele/web-js', '@badele/core'],
  typescript: { ignoreBuildErrors: true },
  // This app is a fixture, not a project: it does not want a generated
  // AGENTS.md and CLAUDE.md appearing in the repository beside it.
  agentRules: false,
}
