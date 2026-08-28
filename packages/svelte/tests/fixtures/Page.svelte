<script lang="ts">
  import { setupBadele, useIdentify, useVerdict, type BadeleOptions, type Confidence } from '../../src/index.js'
  import Child from './Child.svelte'

  interface Props {
    options: BadeleOptions
    immediate?: boolean
    min?: Confidence
    children?: number
    tag?: string | (() => string | undefined)
  }

  const { options, immediate = false, min, children = 0, tag }: Props = $props()

  // These props are fixed for the life of a mounted fixture, and both calls
  // are init-time by design - setting up the context and deciding whether to
  // identify on mount are not things a component changes its mind about.
  // svelte-ignore state_referenced_locally
  const badele = setupBadele(options)
  // svelte-ignore state_referenced_locally
  const identified = useIdentify({
    immediate,
    ...(tag === undefined ? {} : { tag }),
  })
  const incognito = useVerdict('incognito', { min: () => min ?? 'medium' })

  // Exports from the instance script come back from `mount()`, which is how a
  // test reaches identify() without a click handler to fake.
  // What a component actually holds: the hook's result, tag and all.
  export const state = identified
  export const shared = badele
  export const verdict = incognito
</script>

<output>
  ready:{identified.isReady} suspicious:{identified.isSuspicious}
  loading:{identified.isLoading} request:{identified.requestId ?? '-'}
  incognito:{incognito.matched} confidence:{incognito.confidence ?? '-'}
  reasons:{incognito.reasons.join('|') || '-'}
  error:{identified.error?.message ?? '-'}
</output>

{#each Array(children) as _, index (index)}
  <Child />
{/each}
