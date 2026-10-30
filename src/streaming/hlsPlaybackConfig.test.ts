import type { BufferInfo } from 'hls.js'
import { assert, describe, expect, it } from 'vitest'
import {
  fakeNetworkLoader,
  forwardBuffer,
  hlsConfigWith,
  segmentCallbacks,
  segmentContext,
  segmentLoadConfiguration,
} from '../test/fakeNetworkLoader'
import { hlsPlaybackConfig } from './hlsPlaybackConfig'

interface ForwardBuffers {
  mainForwardBufferInfo: BufferInfo | null
  audioForwardBufferInfo: BufferInfo | null
}

function loadSegment(buffers: ForwardBuffers) {
  const network = fakeNetworkLoader()
  const config = hlsConfigWith(
    hlsPlaybackConfig(() => buffers),
    network,
  )
  const SegmentLoader = config.fLoader
  assert(SegmentLoader)
  const loader = new SegmentLoader(config)
  const callbacks = segmentCallbacks()
  loader.load(segmentContext(), segmentLoadConfiguration(), callbacks)
  return { loader, network, callbacks }
}

function firstByteWaitsMs(buffers: ForwardBuffers): number[] {
  return loadSegment(buffers).network.loads.map(
    ({ config }) => config.loadPolicy.maxTimeToFirstByteMs,
  )
}

describe('hlsPlaybackConfig', () => {
  it('shouldWaitForAStartingVariantsFirstSegmentWhenTheForwardBufferOutlastsTheWait', () => {
    expect(
      firstByteWaitsMs({ mainForwardBufferInfo: forwardBuffer(30), audioForwardBufferInfo: null }),
    ).toEqual([20_000])
  })

  it('shouldKeepTheDefaultWaitInReserveWhenTheForwardBufferIsShorterThanBoth', () => {
    expect(
      firstByteWaitsMs({ mainForwardBufferInfo: forwardBuffer(25), audioForwardBufferInfo: null }),
    ).toEqual([15_000])
  })

  it.each([
    {
      buffered: 'short',
      buffers: { mainForwardBufferInfo: forwardBuffer(12), audioForwardBufferInfo: null },
    },
    {
      buffered: 'empty',
      buffers: { mainForwardBufferInfo: forwardBuffer(0), audioForwardBufferInfo: null },
    },
    { buffered: 'unknown', buffers: { mainForwardBufferInfo: null, audioForwardBufferInfo: null } },
  ])('shouldWaitTheDefaultTimeWhenTheForwardBufferIs$buffered', ({ buffers }) => {
    expect(firstByteWaitsMs(buffers)).toEqual([10_000])
  })

  it('shouldWaitOnlyAsLongAsTheAudioBufferAllowsWhenAudioRunsOutFirst', () => {
    expect(
      firstByteWaitsMs({
        mainForwardBufferInfo: forwardBuffer(30),
        audioForwardBufferInfo: forwardBuffer(22),
      }),
    ).toEqual([12_000])
  })

  it('shouldKeepTheRestOfTheSegmentPolicyWhenItExtendsTheWait', () => {
    const { network, callbacks } = loadSegment({
      mainForwardBufferInfo: forwardBuffer(30),
      audioForwardBufferInfo: null,
    })

    expect(network.loads).toEqual([
      {
        context: segmentContext(),
        config: {
          ...segmentLoadConfiguration(),
          loadPolicy: { ...segmentLoadConfiguration().loadPolicy, maxTimeToFirstByteMs: 20_000 },
        },
        callbacks,
      },
    ])
  })

  it('shouldReadTheForwardBufferWhenEachSegmentStartsLoading', () => {
    const buffers: ForwardBuffers = { mainForwardBufferInfo: null, audioForwardBufferInfo: null }
    const network = fakeNetworkLoader()
    const config = hlsConfigWith(
      hlsPlaybackConfig(() => buffers),
      network,
    )
    const SegmentLoader = config.fLoader
    assert(SegmentLoader)
    const loader = new SegmentLoader(config)

    buffers.mainForwardBufferInfo = forwardBuffer(30)
    loader.load(segmentContext(), segmentLoadConfiguration(), segmentCallbacks())

    expect(network.loads.map(({ config }) => config.loadPolicy.maxTimeToFirstByteMs)).toEqual([
      20_000,
    ])
  })

  it('shouldReportTheNetworkLoadersProgressWhenHlsReadsTheSegmentLoader', () => {
    const { loader, network } = loadSegment({
      mainForwardBufferInfo: forwardBuffer(30),
      audioForwardBufferInfo: null,
    })
    const [networkLoader] = network.loaders
    assert(networkLoader)

    expect(loader.stats).toBe(networkLoader.stats)
    expect(loader.context).toBe(networkLoader.context)
  })

  it('shouldStopTheNetworkRequestWhenHlsAbortsOrDestroysTheSegmentLoader', () => {
    const { loader, network } = loadSegment({
      mainForwardBufferInfo: forwardBuffer(30),
      audioForwardBufferInfo: null,
    })
    const [networkLoader] = network.loaders
    assert(networkLoader)

    loader.abort()
    loader.destroy()

    expect(networkLoader.stats.aborted).toBe(true)
    expect(networkLoader.destroyed).toBe(true)
  })
})
