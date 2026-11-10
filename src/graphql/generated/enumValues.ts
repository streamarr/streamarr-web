export const AccountInvitationStatus = {
  Accepted: 'ACCEPTED',
  Canceled: 'CANCELED',
  Declined: 'DECLINED',
  Expired: 'EXPIRED',
  Invalidated: 'INVALIDATED',
  Pending: 'PENDING'
} as const;

export type AccountInvitationStatus = typeof AccountInvitationStatus[keyof typeof AccountInvitationStatus];
export const AlphabetLetter = {
  A: 'A',
  B: 'B',
  C: 'C',
  D: 'D',
  E: 'E',
  F: 'F',
  G: 'G',
  H: 'H',
  Hash: 'HASH',
  I: 'I',
  J: 'J',
  K: 'K',
  L: 'L',
  M: 'M',
  N: 'N',
  O: 'O',
  P: 'P',
  Q: 'Q',
  R: 'R',
  S: 'S',
  T: 'T',
  U: 'U',
  V: 'V',
  W: 'W',
  X: 'X',
  Y: 'Y',
  Z: 'Z'
} as const;

export type AlphabetLetter = typeof AlphabetLetter[keyof typeof AlphabetLetter];
/** An audio codec that a client can declare. */
export const AudioCodec = {
  Aac: 'AAC',
  Ac3: 'AC3',
  Alac: 'ALAC',
  Eac3: 'EAC3',
  Flac: 'FLAC',
  Opus: 'OPUS'
} as const;

export type AudioCodec = typeof AudioCodec[keyof typeof AudioCodec];
export const BitstreamRewrite = {
  /** Removes the enhancement layer and rewrites RPUs without the FEL residual. */
  ConvertDolbyVisionProfile_7To_8_1: 'CONVERT_DOLBY_VISION_PROFILE_7_TO_8_1',
  NormalizeDolbyVisionRecord: 'NORMALIZE_DOLBY_VISION_RECORD',
  StripDolbyVision: 'STRIP_DOLBY_VISION',
  StripHdr10Plus: 'STRIP_HDR10_PLUS'
} as const;

export type BitstreamRewrite = typeof BitstreamRewrite[keyof typeof BitstreamRewrite];
/** The delivery for which the server checked a capability entry. */
export const CapabilityEntryDelivery = {
  /** Direct play of the source file from its source container. */
  DirectPlay: 'DIRECT_PLAY',
  /** A stream copy over HLS. */
  Hls: 'HLS'
} as const;

export type CapabilityEntryDelivery = typeof CapabilityEntryDelivery[keyof typeof CapabilityEntryDelivery];
export const ChapterStatus = {
  /** The probe listed the container's chapters. The list is empty when the container defines no chapters. */
  Known: 'KNOWN',
  /** The container defines chapters, but the probe left them out because together they exceed the probe's chapter limit. */
  Omitted: 'OMITTED',
  /** No stored probe outcome lists the chapters: the file has no outcome yet, its probe failed, or its probe version reports no chapters. */
  Unknown: 'UNKNOWN'
} as const;

export type ChapterStatus = typeof ChapterStatus[keyof typeof ChapterStatus];
export const ChromaSubsampling = {
  Chroma_420: 'CHROMA_420',
  Chroma_422: 'CHROMA_422',
  Chroma_444: 'CHROMA_444',
  Monochrome: 'MONOCHROME'
} as const;

export type ChromaSubsampling = typeof ChromaSubsampling[keyof typeof ChromaSubsampling];
/** PQ is the SMPTE ST 2084 Perceptual Quantizer transfer function; it alone does not prove HDR10. */
export const CompatibleBase = {
  Hlg: 'HLG',
  None: 'NONE',
  Pq: 'PQ',
  Sdr: 'SDR',
  Unspecified: 'UNSPECIFIED'
} as const;

export type CompatibleBase = typeof CompatibleBase[keyof typeof CompatibleBase];
/**
 * Why a format attempt's output differs from its source: why the source file does not play directly, why the
 * server encodes the video or the audio, or what a copy leaves out. The stream decision names each reason as it
 * decides, so the reasons agree with the output. When no entry accepts a copy, "the closest entry" is the client's video
 * capability entry for HLS of the source's codec family that refuses the fewest properties. When an entry accepts a copy
 * only after the copy leaves out Dolby Vision or HDR10+, "the closest entry" is that accepting entry, and the reasons name
 * what it refused in the copies that kept more.
 */
export const DecisionReason = {
  /**
   * The source's FLAC minimum block size is below the minimum of each audio entry for HLS that accepts the rest of the
   * copy.
   */
  AudioBlockSizeNotDeclared: 'AUDIO_BLOCK_SIZE_NOT_DECLARED',
  /**
   * The probe stored no FLAC minimum block size for the source's audio, and each audio entry for HLS that accepts the
   * rest of the copy gives a minimum.
   */
  AudioBlockSizeUnknown: 'AUDIO_BLOCK_SIZE_UNKNOWN',
  /** The source has more audio channels than the entry for its codec accepts. */
  AudioChannelsNotDeclared: 'AUDIO_CHANNELS_NOT_DECLARED',
  /**
   * The probe reported no channel count for the source's audio, and the entry for its codec accepts fewer channels than
   * the stereo track the server then assumes.
   */
  AudioChannelsUnknown: 'AUDIO_CHANNELS_UNKNOWN',
  /** No audio capability entry for HLS names the source's audio codec. */
  AudioCodecNotDeclared: 'AUDIO_CODEC_NOT_DECLARED',
  /** The probe stored no codec string for the source's audio, which a playlist needs to describe a copy. */
  AudioCodecStringUnknown: 'AUDIO_CODEC_STRING_UNKNOWN',
  /** The audio ends at least one segment before another stream of the source, so the encode pads it with silence to the end. */
  AudioEndsEarly: 'AUDIO_ENDS_EARLY',
  /**
   * The client's maximum bitrate takes a lower audio step. The output can still exceed a maximum below the lowest
   * audio and video rates that the server encodes.
   */
  AudioLoweredForBitrateLimit: 'AUDIO_LOWERED_FOR_BITRATE_LIMIT',
  /** HLS delivery cannot copy the source's audio codec profile, such as AAC Main. */
  AudioSourceNotCopyable: 'AUDIO_SOURCE_NOT_COPYABLE',
  /** A copy costs more than the client's maximum bitrate beside every audio step. */
  BitrateAboveViewerLimit: 'BITRATE_ABOVE_VIEWER_LIMIT',
  /** The copy of the format attempt before this one failed, so this one encodes the video. */
  CopyFailed: 'COPY_FAILED',
  /** An audio track of the file is one that no audio capability entry listing the file's source container accepts. */
  DirectPlayAudioNotDeclared: 'DIRECT_PLAY_AUDIO_NOT_DECLARED',
  /**
   * The player cannot select an audio track inside a file that it direct-plays, and it would not start on the audio
   * track that the viewer chose: the viewer chose a later track, or the file marks another track as its default. The
   * format attempt that the viewer's audio switch moves from direct play to HLS names it too.
   */
  DirectPlayAudioTrackNotSelectable: 'DIRECT_PLAY_AUDIO_TRACK_NOT_SELECTABLE',
  /**
   * No video capability entry of the source's codec family lists the file's source container for direct play, or,
   * for a file with audio, no audio capability entry lists it.
   */
  DirectPlayContainerNotDeclared: 'DIRECT_PLAY_CONTAINER_NOT_DECLARED',
  /** The direct play of the format attempt before this one failed, so this one plays over HLS. */
  DirectPlayFailed: 'DIRECT_PLAY_FAILED',
  /**
   * No video capability entry that lists the MP4 or MOV container lists the video stream's sample entry, such as
   * hev1, or the probe stored no sample entry.
   */
  DirectPlaySampleEntryNotDeclared: 'DIRECT_PLAY_SAMPLE_ENTRY_NOT_DECLARED',
  /**
   * No video capability entry that lists the file's source container accepts every property of the video stream as
   * it is, or the probe left one of those properties unknown.
   */
  DirectPlayVideoNotDeclared: 'DIRECT_PLAY_VIDEO_NOT_DECLARED',
  /** The source's Dolby Vision configuration claims another base than the source's transfer signals. */
  DolbyVisionCompatibilityDisagreesWithTransfer: 'DOLBY_VISION_COMPATIBILITY_DISAGREES_WITH_TRANSFER',
  /**
   * The Dolby Vision copy of the format attempt before this one failed, so this one copies the video with its Dolby
   * Vision stripped, or encodes it when the client or the workers rule that copy out.
   */
  DolbyVisionCopyFailed: 'DOLBY_VISION_COPY_FAILED',
  /** The closest entry does not declare the source's Dolby Vision profile and level. */
  DolbyVisionNotDeclared: 'DOLBY_VISION_NOT_DECLARED',
  /** The probe found no Dolby Vision profile or level for the source, so no entry can accept its Dolby Vision. */
  DolbyVisionProfileOrLevelUnknown: 'DOLBY_VISION_PROFILE_OR_LEVEL_UNKNOWN',
  /** The source's Dolby Vision RPUs start their samples, so a copy or direct play would hand players misplaced RPUs. */
  DolbyVisionRpuStartsSample: 'DOLBY_VISION_RPU_STARTS_SAMPLE',
  /** The closest entry does not declare the source's compatible base: SDR, PQ or HLG. */
  DynamicRangeNotDeclared: 'DYNAMIC_RANGE_NOT_DECLARED',
  /** The encode of the format attempt before this one failed, so this one encodes in another codec family. */
  EncodeFailed: 'ENCODE_FAILED',
  /** A forced image subtitle track, PGS, VobSub or DVB, is in the language of an audio track. */
  ForcedImageSubtitleInAudioLanguage: 'FORCED_IMAGE_SUBTITLE_IN_AUDIO_LANGUAGE',
  /** The source is H.264 at another bit depth or chroma subsampling than 8-bit 4:2:0. */
  H264Not_8Bit_4_2_0: 'H264_NOT_8_BIT_4_2_0',
  /**
   * The hardware encoder of the format attempt before this one failed, so this one encodes the same codec family with
   * the software encoder. That format attempt does not count against maximumFormatAttempts (ADR 0044).
   */
  HardwareEncoderFailed: 'HARDWARE_ENCODER_FAILED',
  /** The closest entry does not declare HDR10+. */
  Hdr10PlusNotDeclared: 'HDR10_PLUS_NOT_DECLARED',
  /** A copy that keeps Dolby Vision strips the source's HDR10+ information, whatever the client declares. */
  Hdr10PlusStrippedBesideDolbyVision: 'HDR10_PLUS_STRIPPED_BESIDE_DOLBY_VISION',
  /** No source keyframe lies between the start and the end of the media, so no copied segment opens. */
  KeyframesTooSparse: 'KEYFRAMES_TOO_SPARSE',
  /** The source's keyframe positions are not known yet. */
  KeyframesUnknown: 'KEYFRAMES_UNKNOWN',
  /** The source's keyframe timestamps go backwards or out of range. */
  KeyframeTimestampsInvalid: 'KEYFRAME_TIMESTAMPS_INVALID',
  /** No connected worker can make the copy's planned output. */
  NoWorkerDeliversCopy: 'NO_WORKER_DELIVERS_COPY',
  /** The source's picture is larger than the fixed quality or the maximum size that the client sent. */
  PictureAboveViewerLimit: 'PICTURE_ABOVE_VIEWER_LIMIT',
  /** The source's sample entry is not one under which a playlist describes a copy, such as hev1. */
  SampleEntryNotCopyable: 'SAMPLE_ENTRY_NOT_COPYABLE',
  /** A copied segment, with the audio beside it, would be larger than a segment may be. */
  SegmentExceedsCap: 'SEGMENT_EXCEEDS_CAP',
  /** The probe found no single source container that a client can declare for direct play. */
  SourceContainerUnknown: 'SOURCE_CONTAINER_UNKNOWN',
  /** The source is interlaced. HLS delivery needs progressive video, and direct play of an interlaced file is unmeasured. */
  SourceInterlaced: 'SOURCE_INTERLACED',
  /** The probe stored no start time correction for the source's container, which a copy needs to start its segments at the source's keyframes. */
  StartTimeCorrectionUnknown: 'START_TIME_CORRECTION_UNKNOWN',
  /** The source's bit depth is above the closest entry's maximum. */
  VideoBitDepthNotDeclared: 'VIDEO_BIT_DEPTH_NOT_DECLARED',
  /** The probe reported no bit depth for the source's video, so no entry can accept a copy. */
  VideoBitDepthUnknown: 'VIDEO_BIT_DEPTH_UNKNOWN',
  /** The probe reported no chroma subsampling for the source's H.264 video. */
  VideoChromaSubsamplingUnknown: 'VIDEO_CHROMA_SUBSAMPLING_UNKNOWN',
  /** The source's codec level or tier is above the closest entry's maximum for its profile. */
  VideoCodecLevelNotDeclared: 'VIDEO_CODEC_LEVEL_NOT_DECLARED',
  /** No video capability entry for HLS names the source's codec family. */
  VideoCodecNotDeclared: 'VIDEO_CODEC_NOT_DECLARED',
  /** The closest entry does not list the source's codec profile. */
  VideoCodecProfileNotDeclared: 'VIDEO_CODEC_PROFILE_NOT_DECLARED',
  /** The probe could not name the source's codec profile. */
  VideoCodecProfileUnknown: 'VIDEO_CODEC_PROFILE_UNKNOWN',
  /** The probe stored no codec string for the source's video, which a playlist needs to describe a copy. */
  VideoCodecStringUnknown: 'VIDEO_CODEC_STRING_UNKNOWN',
  /** The probe reported no codec name for the source's video. */
  VideoCodecUnknown: 'VIDEO_CODEC_UNKNOWN',
  /** The source's video ends at least one segment before another stream of the source, so the encode holds its last frame to the end. */
  VideoEndsEarly: 'VIDEO_ENDS_EARLY',
  /** The source's frame rate is above the closest entry's maximum. */
  VideoFrameRateNotDeclared: 'VIDEO_FRAME_RATE_NOT_DECLARED',
  /** The source's picture is larger than the closest entry's maximum. */
  VideoPictureSizeNotDeclared: 'VIDEO_PICTURE_SIZE_NOT_DECLARED',
  /** The source's HDR base was probed before the probe described its codec profile. */
  VideoPropertiesNotProbed: 'VIDEO_PROPERTIES_NOT_PROBED',
  /** The probe stored no video facts for a copy. */
  VideoSourceNotCopyable: 'VIDEO_SOURCE_NOT_COPYABLE',
  /** The viewer chose SDR in a fixed quality, and a copy would keep the source's HDR range, so the server encodes SDR. */
  ViewerChoseSdr: 'VIEWER_CHOSE_SDR'
} as const;

export type DecisionReason = typeof DecisionReason[keyof typeof DecisionReason];
/** A standard picture format that a player displays without a stream's advanced HDR information. */
export const DeclaredCompatibleBase = {
  /** Hybrid log-gamma, ARIB STD-B67. */
  Hlg: 'HLG',
  /** SMPTE ST 2084, which covers HDR10 and PQ10. */
  Pq: 'PQ',
  /** Standard dynamic range. */
  Sdr: 'SDR'
} as const;

export type DeclaredCompatibleBase = typeof DeclaredCompatibleBase[keyof typeof DeclaredCompatibleBase];
export const DeviceRegistrationStatus = {
  Active: 'ACTIVE',
  Revoked: 'REVOKED'
} as const;

export type DeviceRegistrationStatus = typeof DeviceRegistrationStatus[keyof typeof DeviceRegistrationStatus];
export const DolbyVisionEnhancementLayer = {
  Fel: 'FEL',
  Mel: 'MEL',
  None: 'NONE',
  Unspecified: 'UNSPECIFIED'
} as const;

export type DolbyVisionEnhancementLayer = typeof DolbyVisionEnhancementLayer[keyof typeof DolbyVisionEnhancementLayer];
/** A single-layer Dolby Vision profile. No value names profile 7, which needs dual-layer playback. */
export const DolbyVisionProfile = {
  Profile_5: 'PROFILE_5',
  Profile_8_1: 'PROFILE_8_1',
  Profile_8_4: 'PROFILE_8_4',
  Profile_10_0: 'PROFILE_10_0',
  Profile_10_1: 'PROFILE_10_1',
  Profile_10_4: 'PROFILE_10_4'
} as const;

export type DolbyVisionProfile = typeof DolbyVisionProfile[keyof typeof DolbyVisionProfile];
/** The viewer's HDR choice in a fixed quality. */
export const DynamicRangeChoice = {
  /** Keep the source's HDR range when the client declares it. */
  Hdr: 'HDR',
  /** Play an HDR source as an SDR encode. */
  Sdr: 'SDR'
} as const;

export type DynamicRangeChoice = typeof DynamicRangeChoice[keyof typeof DynamicRangeChoice];
/** A preset on the scale that every software encoder uses, from fastest to slowest. */
export const EncoderPreset = {
  Fast: 'FAST',
  Faster: 'FASTER',
  Medium: 'MEDIUM',
  Slow: 'SLOW',
  Slower: 'SLOWER',
  Superfast: 'SUPERFAST',
  Veryfast: 'VERYFAST',
  Veryslow: 'VERYSLOW'
} as const;

export type EncoderPreset = typeof EncoderPreset[keyof typeof EncoderPreset];
/** Automatic, or one fixed preset from the scale. */
export const EncoderPresetChoice = {
  Automatic: 'AUTOMATIC',
  Fast: 'FAST',
  Faster: 'FASTER',
  Medium: 'MEDIUM',
  Slow: 'SLOW',
  Slower: 'SLOWER',
  Superfast: 'SUPERFAST',
  Veryfast: 'VERYFAST',
  Veryslow: 'VERYSLOW'
} as const;

export type EncoderPresetChoice = typeof EncoderPresetChoice[keyof typeof EncoderPresetChoice];
export const ExternalAgentStrategy = {
  Tmdb: 'TMDB'
} as const;

export type ExternalAgentStrategy = typeof ExternalAgentStrategy[keyof typeof ExternalAgentStrategy];
export const HouseholdRole = {
  Admin: 'ADMIN',
  Member: 'MEMBER'
} as const;

export type HouseholdRole = typeof HouseholdRole[keyof typeof HouseholdRole];
export const ImageRefreshMode = {
  ForceRefresh: 'FORCE_REFRESH',
  Preserve: 'PRESERVE',
  RefreshIfChanged: 'REFRESH_IF_CHANGED'
} as const;

export type ImageRefreshMode = typeof ImageRefreshMode[keyof typeof ImageRefreshMode];
export const ImageSize = {
  Large: 'LARGE',
  Medium: 'MEDIUM',
  Original: 'ORIGINAL',
  Small: 'SMALL'
} as const;

export type ImageSize = typeof ImageSize[keyof typeof ImageSize];
export const ImageType = {
  Backdrop: 'BACKDROP',
  Logo: 'LOGO',
  Poster: 'POSTER',
  Profile: 'PROFILE',
  Still: 'STILL'
} as const;

export type ImageType = typeof ImageType[keyof typeof ImageType];
/**
 * A language that a Profile's language preferences name (ADR 0043). Each value's description is
 * its BCP 47 tag. The server maps each value to the codes that files tag a stream with, such as
 * fr, fra and fre for FR. A tag with a region or script that has no value of its own, such as
 * pt-PT, reads as its base language.
 */
export const Language = {
  /** aa */
  Aa: 'AA',
  /** ab */
  Ab: 'AB',
  /** ae */
  Ae: 'AE',
  /** af */
  Af: 'AF',
  /** ak */
  Ak: 'AK',
  /** am */
  Am: 'AM',
  /** an */
  An: 'AN',
  /** ar */
  Ar: 'AR',
  /** as */
  As: 'AS',
  /** av */
  Av: 'AV',
  /** ay */
  Ay: 'AY',
  /** az */
  Az: 'AZ',
  /** ba */
  Ba: 'BA',
  /** be */
  Be: 'BE',
  /** bg */
  Bg: 'BG',
  /** bi */
  Bi: 'BI',
  /** bm */
  Bm: 'BM',
  /** bn */
  Bn: 'BN',
  /** bo */
  Bo: 'BO',
  /** br */
  Br: 'BR',
  /** bs */
  Bs: 'BS',
  /** ca */
  Ca: 'CA',
  /** ce */
  Ce: 'CE',
  /** ch */
  Ch: 'CH',
  /** co */
  Co: 'CO',
  /** cr */
  Cr: 'CR',
  /** cs */
  Cs: 'CS',
  /** cu */
  Cu: 'CU',
  /** cv */
  Cv: 'CV',
  /** cy */
  Cy: 'CY',
  /** da */
  Da: 'DA',
  /** de */
  De: 'DE',
  /** dv */
  Dv: 'DV',
  /** dz */
  Dz: 'DZ',
  /** ee */
  Ee: 'EE',
  /** el */
  El: 'EL',
  /** en */
  En: 'EN',
  /** eo */
  Eo: 'EO',
  /** es */
  Es: 'ES',
  /** es-419 */
  Es_419: 'ES_419',
  /** et */
  Et: 'ET',
  /** eu */
  Eu: 'EU',
  /** fa */
  Fa: 'FA',
  /** ff */
  Ff: 'FF',
  /** fi */
  Fi: 'FI',
  /** fj */
  Fj: 'FJ',
  /** fo */
  Fo: 'FO',
  /** fr */
  Fr: 'FR',
  /** fy */
  Fy: 'FY',
  /** ga */
  Ga: 'GA',
  /** gd */
  Gd: 'GD',
  /** gl */
  Gl: 'GL',
  /** gn */
  Gn: 'GN',
  /** gu */
  Gu: 'GU',
  /** gv */
  Gv: 'GV',
  /** ha */
  Ha: 'HA',
  /** he */
  He: 'HE',
  /** hi */
  Hi: 'HI',
  /** ho */
  Ho: 'HO',
  /** hr */
  Hr: 'HR',
  /** ht */
  Ht: 'HT',
  /** hu */
  Hu: 'HU',
  /** hy */
  Hy: 'HY',
  /** hz */
  Hz: 'HZ',
  /** ia */
  Ia: 'IA',
  /** id */
  Id: 'ID',
  /** ie */
  Ie: 'IE',
  /** ig */
  Ig: 'IG',
  /** ii */
  Ii: 'II',
  /** ik */
  Ik: 'IK',
  /** io */
  Io: 'IO',
  /** is */
  Is: 'IS',
  /** it */
  It: 'IT',
  /** iu */
  Iu: 'IU',
  /** ja */
  Ja: 'JA',
  /** jv */
  Jv: 'JV',
  /** ka */
  Ka: 'KA',
  /** kg */
  Kg: 'KG',
  /** ki */
  Ki: 'KI',
  /** kj */
  Kj: 'KJ',
  /** kk */
  Kk: 'KK',
  /** kl */
  Kl: 'KL',
  /** km */
  Km: 'KM',
  /** kn */
  Kn: 'KN',
  /** ko */
  Ko: 'KO',
  /** kr */
  Kr: 'KR',
  /** ks */
  Ks: 'KS',
  /** ku */
  Ku: 'KU',
  /** kv */
  Kv: 'KV',
  /** kw */
  Kw: 'KW',
  /** ky */
  Ky: 'KY',
  /** la */
  La: 'LA',
  /** lb */
  Lb: 'LB',
  /** lg */
  Lg: 'LG',
  /** li */
  Li: 'LI',
  /** ln */
  Ln: 'LN',
  /** lo */
  Lo: 'LO',
  /** lt */
  Lt: 'LT',
  /** lu */
  Lu: 'LU',
  /** lv */
  Lv: 'LV',
  /** mg */
  Mg: 'MG',
  /** mh */
  Mh: 'MH',
  /** mi */
  Mi: 'MI',
  /** mk */
  Mk: 'MK',
  /** ml */
  Ml: 'ML',
  /** mn */
  Mn: 'MN',
  /** mr */
  Mr: 'MR',
  /** ms */
  Ms: 'MS',
  /** mt */
  Mt: 'MT',
  /** my */
  My: 'MY',
  /** na */
  Na: 'NA',
  /** nb */
  Nb: 'NB',
  /** nd */
  Nd: 'ND',
  /** ne */
  Ne: 'NE',
  /** ng */
  Ng: 'NG',
  /** nl */
  Nl: 'NL',
  /** nn */
  Nn: 'NN',
  /** no */
  No: 'NO',
  /** nr */
  Nr: 'NR',
  /** nv */
  Nv: 'NV',
  /** ny */
  Ny: 'NY',
  /** oc */
  Oc: 'OC',
  /** oj */
  Oj: 'OJ',
  /** om */
  Om: 'OM',
  /** or */
  Or: 'OR',
  /** os */
  Os: 'OS',
  /** pa */
  Pa: 'PA',
  /** pi */
  Pi: 'PI',
  /** pl */
  Pl: 'PL',
  /** ps */
  Ps: 'PS',
  /** pt */
  Pt: 'PT',
  /** pt-BR */
  PtBr: 'PT_BR',
  /** qu */
  Qu: 'QU',
  /** rm */
  Rm: 'RM',
  /** rn */
  Rn: 'RN',
  /** ro */
  Ro: 'RO',
  /** ru */
  Ru: 'RU',
  /** rw */
  Rw: 'RW',
  /** sa */
  Sa: 'SA',
  /** sc */
  Sc: 'SC',
  /** sd */
  Sd: 'SD',
  /** se */
  Se: 'SE',
  /** sg */
  Sg: 'SG',
  /** si */
  Si: 'SI',
  /** sk */
  Sk: 'SK',
  /** sl */
  Sl: 'SL',
  /** sm */
  Sm: 'SM',
  /** sn */
  Sn: 'SN',
  /** so */
  So: 'SO',
  /** sq */
  Sq: 'SQ',
  /** sr */
  Sr: 'SR',
  /** ss */
  Ss: 'SS',
  /** st */
  St: 'ST',
  /** su */
  Su: 'SU',
  /** sv */
  Sv: 'SV',
  /** sw */
  Sw: 'SW',
  /** ta */
  Ta: 'TA',
  /** te */
  Te: 'TE',
  /** tg */
  Tg: 'TG',
  /** th */
  Th: 'TH',
  /** ti */
  Ti: 'TI',
  /** tk */
  Tk: 'TK',
  /** tl */
  Tl: 'TL',
  /** tn */
  Tn: 'TN',
  /** to */
  To: 'TO',
  /** tr */
  Tr: 'TR',
  /** ts */
  Ts: 'TS',
  /** tt */
  Tt: 'TT',
  /** tw */
  Tw: 'TW',
  /** ty */
  Ty: 'TY',
  /** ug */
  Ug: 'UG',
  /** uk */
  Uk: 'UK',
  /** ur */
  Ur: 'UR',
  /** uz */
  Uz: 'UZ',
  /** ve */
  Ve: 'VE',
  /** vi */
  Vi: 'VI',
  /** vo */
  Vo: 'VO',
  /** wa */
  Wa: 'WA',
  /** wo */
  Wo: 'WO',
  /** xh */
  Xh: 'XH',
  /** yi */
  Yi: 'YI',
  /** yo */
  Yo: 'YO',
  /** za */
  Za: 'ZA',
  /** zh */
  Zh: 'ZH',
  /** zh-Hans */
  ZhHans: 'ZH_HANS',
  /** zh-Hant */
  ZhHant: 'ZH_HANT',
  /** zu */
  Zu: 'ZU'
} as const;

export type Language = typeof Language[keyof typeof Language];
export const LibraryBackend = {
  Local: 'LOCAL',
  Remote: 'REMOTE'
} as const;

export type LibraryBackend = typeof LibraryBackend[keyof typeof LibraryBackend];
/** How a path overlaps another library's path. */
export const LibraryPathOverlap = {
  /** The path contains the other library's path. */
  Contains: 'CONTAINS',
  /** The path is inside the other library's path. */
  Inside: 'INSIDE'
} as const;

export type LibraryPathOverlap = typeof LibraryPathOverlap[keyof typeof LibraryPathOverlap];
export const LibraryStatus = {
  Healthy: 'HEALTHY',
  Refreshing: 'REFRESHING',
  Scanning: 'SCANNING',
  /** A ServerAdmin stopped the library's scan or refresh. Its admitted tasks finish, and then the library returns to the status it had before the scan or refresh started. */
  Stopping: 'STOPPING',
  Unhealthy: 'UNHEALTHY'
} as const;

export type LibraryStatus = typeof LibraryStatus[keyof typeof LibraryStatus];
export const MediaType = {
  Movie: 'MOVIE',
  Other: 'OTHER',
  Series: 'SERIES'
} as const;

export type MediaType = typeof MediaType[keyof typeof MediaType];
export const MetadataPresence = {
  Absent: 'ABSENT',
  Present: 'PRESENT',
  Unspecified: 'UNSPECIFIED'
} as const;

export type MetadataPresence = typeof MetadataPresence[keyof typeof MetadataPresence];
export const OrderMediaBy = {
  Added: 'ADDED',
  LastWatched: 'LAST_WATCHED',
  ReleaseDate: 'RELEASE_DATE',
  Runtime: 'RUNTIME',
  Title: 'TITLE'
} as const;

export type OrderMediaBy = typeof OrderMediaBy[keyof typeof OrderMediaBy];
/** How a format attempt delivers one track. */
export const PlaybackDelivery = {
  /** A stream copy of the source's track. */
  Copy: 'COPY',
  /** The source file as it is, without HLS. */
  DirectPlay: 'DIRECT_PLAY',
  /** An encode of the source's track. */
  Encode: 'ENCODE'
} as const;

export type PlaybackDelivery = typeof PlaybackDelivery[keyof typeof PlaybackDelivery];
/** Why the output differs from the output that the requested playback choice asked for (ADR 0052). */
export const PlaybackFormatChange = {
  /** The viewer switched audio tracks during direct play and the server rules out the HLS copy. An encode plays. */
  AudioTrackSwitched: 'AUDIO_TRACK_SWITCHED',
  /** An HLS copy failed: the player refused it, the worker could not make it, or it ran short while a source stream still had media. An encode plays. */
  CopyFailed: 'COPY_FAILED',
  /** Direct play failed and the server rules out the HLS copy. An encode plays. */
  DirectPlayFailed: 'DIRECT_PLAY_FAILED',
  /** A Dolby Vision copy failed, so the same copy without Dolby Vision plays on the source's PQ or HLG base. */
  DolbyVisionStripped: 'DOLBY_VISION_STRIPPED',
  /** Original could neither direct-play nor copy the source, so its first format attempt is an encode. */
  StartedWithEncode: 'STARTED_WITH_ENCODE'
} as const;

export type PlaybackFormatChange = typeof PlaybackFormatChange[keyof typeof PlaybackFormatChange];
export const PlaybackFormatFailure = {
  DecodeError: 'DECODE_ERROR',
  UnsupportedFormat: 'UNSUPPORTED_FORMAT'
} as const;

export type PlaybackFormatFailure = typeof PlaybackFormatFailure[keyof typeof PlaybackFormatFailure];
export const PlaybackState = {
  Paused: 'PAUSED',
  Playing: 'PLAYING',
  Stopped: 'STOPPED'
} as const;

export type PlaybackState = typeof PlaybackState[keyof typeof PlaybackState];
/** The level that a language preference comes from. */
export const PreferenceSource = {
  /** The Profile's own preferences. */
  Profile: 'PROFILE',
  /** The Profile's override for the season. */
  Season: 'SEASON',
  /** The Profile's override for the series. */
  Series: 'SERIES',
  /** The Profile's override for the episode or the movie itself. */
  Title: 'TITLE'
} as const;

export type PreferenceSource = typeof PreferenceSource[keyof typeof PreferenceSource];
export const ProfileCleanup = {
  /** Delete the Account and Profile pair. */
  EraseProfile: 'ERASE_PROFILE',
  /** Preserve and unlink the Profile with a named replacement manager. */
  PreserveProfile: 'PRESERVE_PROFILE'
} as const;

export type ProfileCleanup = typeof ProfileCleanup[keyof typeof ProfileCleanup];
export const ProfileKind = {
  Adult: 'ADULT',
  Kid: 'KID'
} as const;

export type ProfileKind = typeof ProfileKind[keyof typeof ProfileKind];
export const ProfileManagerInvitationStatus = {
  Accepted: 'ACCEPTED',
  Canceled: 'CANCELED',
  Declined: 'DECLINED',
  Expired: 'EXPIRED',
  Invalidated: 'INVALIDATED',
  Pending: 'PENDING'
} as const;

export type ProfileManagerInvitationStatus = typeof ProfileManagerInvitationStatus[keyof typeof ProfileManagerInvitationStatus];
export const ProfileShareStatus = {
  /** The Profile is available in the Household. */
  Active: 'ACTIVE',
  /** Withdrawn by the offerer, or replaced by a newer offer. */
  Canceled: 'CANCELED',
  /** Ended after being active. */
  Ended: 'ENDED',
  /** Timed out before a decision. */
  Expired: 'EXPIRED',
  /** Withdrawn by the system because its offerer lost authority; invalidationReason says why. */
  Invalidated: 'INVALIDATED',
  /** Offered and awaiting the target Household's decision. */
  Pending: 'PENDING',
  /** Declined by the target Household. */
  Rejected: 'REJECTED'
} as const;

export type ProfileShareStatus = typeof ProfileShareStatus[keyof typeof ProfileShareStatus];
export const SkippedFileReason = {
  /** The file is a soft link. Streamarr never follows a soft link; a hard link is an ordinary file. */
  SoftLink: 'SOFT_LINK',
  /**
   * The scan listed the entry but could not read its attributes, for example because its
   * permissions changed while the scan walked the folder. A folder that a scan cannot read fails
   * the scan instead.
   */
  Unreadable: 'UNREADABLE',
  /**
   * The file's extension is not a supported video type, and the ignore list (subtitles, artwork,
   * metadata, partial downloads and system files) does not ignore it. The filepath shows the
   * extension.
   */
  UnsupportedFileType: 'UNSUPPORTED_FILE_TYPE'
} as const;

export type SkippedFileReason = typeof SkippedFileReason[keyof typeof SkippedFileReason];
export const SortDirection = {
  Asc: 'ASC',
  Desc: 'DESC'
} as const;

export type SortDirection = typeof SortDirection[keyof typeof SortDirection];
/**
 * The container of a media file as the probe found it. Direct play sends the file in this container,
 * with this container's media type.
 */
export const SourceContainer = {
  /** The Advanced Systems Format, as in WMV files. */
  Asf: 'ASF',
  /** Audio Video Interleave. */
  Avi: 'AVI',
  /** Flash Video. */
  Flv: 'FLV',
  /** Matroska, including WebM. */
  Matroska: 'MATROSKA',
  /** The QuickTime file format: a file whose major brand is QuickTime's qt. */
  Mov: 'MOV',
  /** MPEG-4 Part 14: a file whose major brand is not QuickTime's, including M4V and 3GP files, or a file without a major brand. */
  Mp4: 'MP4',
  /** The MPEG-2 program stream, as in MPG and VOB files. */
  MpegPs: 'MPEG_PS',
  /** The MPEG-2 transport stream, including M2TS. */
  MpegTs: 'MPEG_TS'
} as const;

export type SourceContainer = typeof SourceContainer[keyof typeof SourceContainer];
export const SourceHouseholdAccess = {
  /** End the old Household's membership-required share, registrations, and sessions. */
  End: 'END',
  /** Keep the old share as an ordinary visit; warn when the Profile is restricted. */
  KeepAsVisitor: 'KEEP_AS_VISITOR'
} as const;

export type SourceHouseholdAccess = typeof SourceHouseholdAccess[keyof typeof SourceHouseholdAccess];
/** When a subtitle track starts on. */
export const SubtitleMode = {
  /** The track in the subtitle language, whatever the audio. */
  Always: 'ALWAYS',
  /** Only a forced track whose language matches the selected audio. The default. */
  Forced: 'FORCED',
  /** No subtitle track, not even a forced track. */
  Off: 'OFF'
} as const;

export type SubtitleMode = typeof SubtitleMode[keyof typeof SubtitleMode];
export const TranscodeMode = {
  AudioTranscode: 'AUDIO_TRANSCODE',
  FullTranscode: 'FULL_TRANSCODE',
  Remux: 'REMUX',
  VideoTranscode: 'VIDEO_TRANSCODE'
} as const;

export type TranscodeMode = typeof TranscodeMode[keyof typeof TranscodeMode];
/** A video codec family that a client can declare. */
export const VideoCodecFamily = {
  Av1: 'AV1',
  H264: 'H264',
  Hevc: 'HEVC'
} as const;

export type VideoCodecFamily = typeof VideoCodecFamily[keyof typeof VideoCodecFamily];
/** A video codec profile. Each value belongs to the codec family that its prefix names. */
export const VideoCodecProfile = {
  Av1High: 'AV1_HIGH',
  Av1Main: 'AV1_MAIN',
  Av1Professional: 'AV1_PROFESSIONAL',
  H264Baseline: 'H264_BASELINE',
  H264ConstrainedBaseline: 'H264_CONSTRAINED_BASELINE',
  H264Extended: 'H264_EXTENDED',
  H264High: 'H264_HIGH',
  H264High_10: 'H264_HIGH_10',
  H264High_422: 'H264_HIGH_422',
  H264High_444Predictive: 'H264_HIGH_444_PREDICTIVE',
  H264Main: 'H264_MAIN',
  HevcFormatRangeExtensions: 'HEVC_FORMAT_RANGE_EXTENSIONS',
  HevcMain: 'HEVC_MAIN',
  HevcMain_10: 'HEVC_MAIN_10',
  HevcMainStillPicture: 'HEVC_MAIN_STILL_PICTURE'
} as const;

export type VideoCodecProfile = typeof VideoCodecProfile[keyof typeof VideoCodecProfile];
/** The tier of an HEVC or AV1 stream. The High tier is above the Main tier. */
export const VideoCodecTier = {
  High: 'HIGH',
  Main: 'MAIN'
} as const;

export type VideoCodecTier = typeof VideoCodecTier[keyof typeof VideoCodecTier];
export const VideoQuality = {
  Auto: 'AUTO',
  FullHd_1080P: 'FULL_HD_1080P',
  High_720P: 'HIGH_720P',
  Low_360P: 'LOW_360P',
  Medium_480P: 'MEDIUM_480P',
  Original: 'ORIGINAL',
  Uhd_4K: 'UHD_4K'
} as const;

export type VideoQuality = typeof VideoQuality[keyof typeof VideoQuality];
/** The dynamic range of a stream session's video, as an HLS playlist's VIDEO-RANGE attribute names it. */
export const VideoRange = {
  /** Hybrid log-gamma, ARIB STD-B67. */
  Hlg: 'HLG',
  /** SMPTE ST 2084, which covers HDR10, PQ10 and the PQ base of Dolby Vision. */
  Pq: 'PQ',
  Sdr: 'SDR'
} as const;

export type VideoRange = typeof VideoRange[keyof typeof VideoRange];
/** A sample entry: the four characters that name a video stream's coding format in an MP4 or MOV file. */
export const VideoSampleEntry = {
  /** AV1: av01. */
  Av01: 'AV01',
  /** H.264 with its parameter sets in the sample entry: avc1. */
  Avc1: 'AVC1',
  /** H.264 with its parameter sets allowed in the samples: avc3. */
  Avc3: 'AVC3',
  /** Dolby Vision over AV1: dav1. */
  Dav1: 'DAV1',
  /** Dolby Vision over H.264 with its parameter sets in the sample entry: dva1. */
  Dva1: 'DVA1',
  /** Dolby Vision over H.264 with its parameter sets allowed in the samples: dvav. */
  Dvav: 'DVAV',
  /** Dolby Vision over HEVC with its parameter sets in the sample entry: dvh1. */
  Dvh1: 'DVH1',
  /** Dolby Vision over HEVC with its parameter sets allowed in the samples: dvhe. */
  Dvhe: 'DVHE',
  /** HEVC with its parameter sets allowed in the samples: hev1. */
  Hev1: 'HEV1',
  /** HEVC with its parameter sets in the sample entry: hvc1. */
  Hvc1: 'HVC1'
} as const;

export type VideoSampleEntry = typeof VideoSampleEntry[keyof typeof VideoSampleEntry];
export const WatchStatus = {
  InProgress: 'IN_PROGRESS',
  Unwatched: 'UNWATCHED',
  Watched: 'WATCHED'
} as const;

export type WatchStatus = typeof WatchStatus[keyof typeof WatchStatus];