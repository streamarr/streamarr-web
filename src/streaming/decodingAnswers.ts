import type { DecodingAnswer, PlaybackPlatform } from './playbackCapabilities'
import { isWebKit } from './webKit'

type DecodingInfo = NonNullable<PlaybackPlatform['decodingInfo']>

/** The answers a browser gave to decodingInfo while the page stays open. */
export interface DecodingAnswers {
  /**
   * Answers as the browser's decodingInfo does. A question that the browser answered as supported
   * gets that answer without another call. The browser gets one question at a time, in the order of
   * the asks. Refuses or rejects when the browser does, and keeps neither: the next ask of that
   * question goes to the browser again.
   */
  ask: DecodingInfo
}

// WebKit answers its questions one at a time. A synchronous canPlayType or isTypeSupported call
// for a type not asked before waits behind every pending question
// (docs/research/webkit-decoding-info.md). A question that never settles would hold back every
// later question, so after its turn the next one goes out.
const QUESTION_TURN_MS = 250

interface Question {
  answer?: DecodingAnswer
  // Settles with the browser's first supported answer, whichever sending of the question it answers.
  answered: Promise<DecodingAnswer>
  keep: (answer: DecodingAnswer) => void
  // The sending that another ask shares while it waits in line or is within its turn.
  shared?: Promise<DecodingAnswer>
}

/** Asks the browser's own `MediaCapabilities.decodingInfo`. */
export function browserDecodingInfo(
  configuration: MediaDecodingConfiguration,
): Promise<DecodingAnswer> {
  return navigator.mediaCapabilities.decodingInfo(configuration)
}

/**
 * The decoding answers this page keeps: a store on Apple's WebKit, and none in any other browser or
 * where the browser lacks MediaCapabilities.
 */
export function browserDecodingAnswers(): DecodingAnswers | undefined {
  // The source study of Apple's WebKit found no run-time input to the client's questions except
  // page settings, and WebKit keeps no answer itself (docs/research/webkit-decoding-info.md).
  // Chromium bases an answer on how earlier playback went. No source study covers Firefox or
  // WebKit's other ports, such as GStreamer on Linux.
  const onApplesWebKit =
    isWebKit(navigator.userAgent) && /^(?:Mac|iPhone|iPad|iPod)/.test(navigator.platform)
  if (!onApplesWebKit || !('mediaCapabilities' in navigator)) {
    return undefined
  }
  return createDecodingAnswers({ decodingInfo: browserDecodingInfo })
}

/**
 * Keeps each answer of `decodingInfo` that says supported, for as long as the returned object
 * lives. A page creates at most one, and nothing reaches storage, so the answers end when the page
 * closes.
 */
export function createDecodingAnswers({
  decodingInfo,
}: {
  decodingInfo: DecodingInfo
}): DecodingAnswers {
  const questions = new Map<string, Question>()
  const line = createQuestionLine()

  function questionAbout(configuration: MediaDecodingConfiguration): Question {
    const key = questionKey(configuration)
    const known = questions.get(key)
    if (known) {
      return known
    }
    const question = unansweredQuestion()
    questions.set(key, question)
    return question
  }

  async function sendInLine(
    question: Question,
    configuration: MediaDecodingConfiguration,
  ): Promise<DecodingAnswer> {
    let sharing = true
    const stopSharing = () => {
      if (sharing) {
        sharing = false
        question.shared = undefined
      }
    }
    const turn = await line.takeTurn()
    if (question.answer) {
      turn.end()
      return question.answer
    }
    const turnPasses = setTimeout(() => {
      stopSharing()
      turn.end()
    }, QUESTION_TURN_MS)
    try {
      const answer = await decodingInfo(configuration)
      // WebKit resolves a question whose reply it cancelled with the values of a refusal
      // (docs/research/webkit-decoding-info.md), so a refusal may be no answer at all.
      if (!answer.supported) {
        stopSharing()
        return answer
      }
      question.keep(answer)
      return answer
    } catch (error) {
      stopSharing()
      throw error
    } finally {
      clearTimeout(turnPasses)
      turn.end()
    }
  }

  return {
    ask: (configuration) => {
      const question = questionAbout(configuration)
      if (question.answer) {
        return Promise.resolve(question.answer)
      }
      question.shared ??= Promise.race([sendInLine(question, configuration), question.answered])
      return question.shared
    },
  }
}

interface Turn {
  // Lets the next question in line go to the browser. Has no effect after the first call.
  end: () => void
}

// Lets one question at a time go to the browser, in the order the questions take their turns.
function createQuestionLine() {
  const waiting: (() => void)[] = []
  let held = false

  function letNextGo() {
    if (held || waiting.length === 0) {
      return
    }
    held = true
    waiting.shift()?.()
  }

  function turnHoldingTheLine(): Turn {
    let holding = true
    return {
      end: () => {
        if (!holding) {
          return
        }
        holding = false
        held = false
        letNextGo()
      },
    }
  }

  return {
    takeTurn: () =>
      new Promise<Turn>((resolve) => {
        waiting.push(() => resolve(turnHoldingTheLine()))
        letNextGo()
      }),
  }
}

function unansweredQuestion(): Question {
  let resolveAnswered: (answer: DecodingAnswer) => void = () => {}
  const question: Question = {
    answered: new Promise((resolve) => {
      resolveAnswered = resolve
    }),
    keep: (answer) => {
      question.answer ??= answer
      resolveAnswered(answer)
    },
  }
  return question
}

// Two configurations are the same question only when every field is equal, in whatever order the
// fields were written.
function questionKey(configuration: MediaDecodingConfiguration): string {
  return JSON.stringify(configuration, (_field, value: unknown) => withSortedFields(value))
}

function withSortedFields(value: unknown): unknown {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return value
  }
  return Object.fromEntries(
    Object.entries(value).sort(([first], [second]) => first.localeCompare(second)),
  )
}
