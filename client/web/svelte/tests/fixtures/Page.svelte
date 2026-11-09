<script lang="ts">
  import { setupFingerly, useIdentify, type FingerlyOptions } from '../../src/index.js'
  import Child from './Child.svelte'

  interface Props {
    options: FingerlyOptions
    immediate?: boolean
    children?: number
    tag?: string | (() => string | undefined)
  }

  const { options, immediate = false, children = 0, tag }: Props = $props()

  // These props are fixed for the life of a mounted fixture, and both calls
  // are init-time by design - setting up the context and deciding whether to
  // identify on mount are not things a component changes its mind about.
  // svelte-ignore state_referenced_locally
  const fingerly = setupFingerly(options)
  // svelte-ignore state_referenced_locally
  const identified = useIdentify({
    immediate,
    ...(tag === undefined ? {} : { tag }),
  })

  // Exports from the instance script come back from `mount()`, which is how a
  // test reaches identify() without a click handler to fake.
  // What a component actually holds: the hook's result, tag and all.
  export const state = identified
  export const shared = fingerly
</script>

<output>
  ready:{identified.isReady} suspicious:{identified.isSuspicious}
  loading:{identified.isLoading} request:{identified.requestId ?? '-'}
  error:{identified.error?.message ?? '-'}
</output>

{#each Array(children) as _, index (index)}
  <Child />
{/each}
