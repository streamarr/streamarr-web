/* eslint-disable */
/** Internal type. DO NOT USE DIRECTLY. */
type Exact<T extends { [key: string]: unknown }> = { [K in keyof T]: T[K] };
/** Internal type. DO NOT USE DIRECTLY. */
export type Incremental<T> = T | { [P in keyof T]?: P extends ' $fragmentName' | '__typename' ? T[P] : never };
import type { TypedDocumentNode as DocumentNode } from '@graphql-typed-document-node/core';
export type AcceptProfileShareInput = {
  shareId: string | number;
};

export type AddLibraryInput = {
  backend: LibraryBackend;
  externalAgentStrategy?: ExternalAgentStrategy | null | undefined;
  filepath: string;
  name: string;
  type: MediaType;
};

export type AlphabetLetter =
  | 'A'
  | 'B'
  | 'C'
  | 'D'
  | 'E'
  | 'F'
  | 'G'
  | 'H'
  | 'HASH'
  | 'I'
  | 'J'
  | 'K'
  | 'L'
  | 'M'
  | 'N'
  | 'O'
  | 'P'
  | 'Q'
  | 'R'
  | 'S'
  | 'T'
  | 'U'
  | 'V'
  | 'W'
  | 'X'
  | 'Y'
  | 'Z'
  | '%future added value';

/** One audio codec that the player decodes, with the most channels it accepts for that codec. */
export type AudioCapabilityEntryInput = {
  /** The audio codec. */
  codec: AudioCodec;
  /** The source containers from which the player opens a stream of this codec, by direct play. An entry that does not apply to HLS lists at least one. */
  directPlayContainers?: Array<SourceContainer>;
  /** Whether this entry applies to HLS delivery. */
  hls: boolean;
  /** The most channels that the player accepts for this codec. */
  maxChannels: number;
  /**
   * The smallest STREAMINFO minimum block size, in samples, of a FLAC track that the player plays, from
   * 16 to 65,535. Only a FLAC entry gives one. The entry then accepts a FLAC track only when the track's
   * minimum block size is known and at least this size, so a track with smaller or unknown blocks plays
   * as an encode. Without it, the entry accepts every block size.
   */
  minBlockSize?: number | null | undefined;
};

/** An audio codec that a client can declare. */
export type AudioCodec =
  | 'AAC'
  | 'AC3'
  | 'ALAC'
  | 'EAC3'
  | 'FLAC'
  | 'OPUS'
  | '%future added value';

export type BitstreamRewrite =
  /** Removes the enhancement layer and rewrites RPUs without the FEL residual. */
  | 'CONVERT_DOLBY_VISION_PROFILE_7_TO_8_1'
  | 'NORMALIZE_DOLBY_VISION_RECORD'
  | 'STRIP_DOLBY_VISION'
  | 'STRIP_HDR10_PLUS'
  | '%future added value';

export type CancelProfileShareInput = {
  shareId: string | number;
};

export type ChangeEncoderPresetInput = {
  /** A value of EncoderPresetChoice. */
  preset: string;
};

export type ChangeIdleSegmentRetentionInput = {
  minutes: number;
};

export type ChangeNotificationRetentionInput = {
  days: number;
};

export type ChromaSubsampling =
  | 'CHROMA_420'
  | 'CHROMA_422'
  | 'CHROMA_444'
  | 'MONOCHROME'
  | '%future added value';

/**
 * The client capability declaration that a client builds from its current player and display each
 * time it starts a playback session (ADR 0049). The server chooses each output from these capability
 * entries. An output fits only when one capability entry accepts every property of the output; the
 * server never combines the properties of two capability entries. Each capability entry applies to HLS,
 * to direct play from the source containers that it lists, or to both. Every list of the declaration
 * holds at most 32 values, and every maximum must be above zero.
 */
export type ClientCapabilityDeclarationInput = {
  /** The audio capability entries. The declaration needs at least one, including an AAC entry that applies to HLS. */
  audio: Array<AudioCapabilityEntryInput>;
  /**
   * Whether the player selects an audio track inside a file that it direct-plays, as AVPlayer and Safari's
   * player do (ADR 0045). A player that cannot, such as Chromium's, starts on the file's default audio track,
   * or on its first audio track when none is marked default. It direct-plays a file only when the stream
   * session's audio track is the file's first audio track and the player starts on it, and otherwise plays
   * over HLS from the start.
   */
  selectsAudioTrackInDirectPlay: boolean;
  /** The video capability entries. The declaration needs at least one. */
  video: Array<VideoCapabilityEntryInput>;
};

/** PQ is the SMPTE ST 2084 Perceptual Quantizer transfer function; it alone does not prove HDR10. */
export type CompatibleBase =
  | 'HLG'
  | 'NONE'
  | 'PQ'
  | 'SDR'
  | 'UNSPECIFIED'
  | '%future added value';

export type CreatePlaybackSessionInput = {
  /** What the client's current player and display accept. */
  capabilities: ClientCapabilityDeclarationInput;
  mediaFileId: string | number;
  options?: StreamingOptionsInput | null | undefined;
  /**
   * Where playback starts, in seconds from the start of the media, such as the viewer's resume position.
   * It must be 0 or more and less than the media's duration. The server refuses any other value with
   * StartPositionOutOfRangeError. An HLS stream session starts its first job attempt at the segment that
   * holds this position, and its multivariant playlist marks the position with EXT-X-START. A direct-play
   * stream session returns the position, and the client seeks the file there. A later format attempt
   * starts at this position too, until the client reports a playback position in another second. Null
   * starts playback at the beginning of the media.
   */
  startPositionSeconds?: number | null | undefined;
};

/**
 * Why a format attempt's output differs from its source: why the source file does not play directly, why the
 * server encodes the video or the audio, or what a copy leaves out. The stream decision names each reason as it
 * decides, so the reasons agree with the output. When no entry accepts a copy, "the closest entry" is the client's video
 * capability entry for HLS of the source's codec family that refuses the fewest properties. When an entry accepts a copy
 * only after the copy leaves out Dolby Vision or HDR10+, "the closest entry" is that accepting entry, and the reasons name
 * what it refused in the copies that kept more.
 */
export type DecisionReason =
  /**
   * The source's FLAC minimum block size is below the minimum of each audio entry for HLS that accepts the rest of the
   * copy.
   */
  | 'AUDIO_BLOCK_SIZE_NOT_DECLARED'
  /**
   * The probe stored no FLAC minimum block size for the source's audio, and each audio entry for HLS that accepts the
   * rest of the copy gives a minimum.
   */
  | 'AUDIO_BLOCK_SIZE_UNKNOWN'
  /** The source has more audio channels than the entry for its codec accepts. */
  | 'AUDIO_CHANNELS_NOT_DECLARED'
  /**
   * The probe reported no channel count for the source's audio, and the entry for its codec accepts fewer channels than
   * the stereo track the server then assumes.
   */
  | 'AUDIO_CHANNELS_UNKNOWN'
  /** No audio capability entry for HLS names the source's audio codec. */
  | 'AUDIO_CODEC_NOT_DECLARED'
  /** The probe stored no codec string for the source's audio, which a playlist needs to describe a copy. */
  | 'AUDIO_CODEC_STRING_UNKNOWN'
  /** The audio ends at least one segment before another stream of the source, so the encode pads it with silence to the end. */
  | 'AUDIO_ENDS_EARLY'
  /**
   * The client's maximum bitrate takes a lower audio step. The output can still exceed a maximum below the lowest
   * audio and video rates that the server encodes.
   */
  | 'AUDIO_LOWERED_FOR_BITRATE_LIMIT'
  /** HLS delivery cannot copy the source's audio codec profile, such as AAC Main. */
  | 'AUDIO_SOURCE_NOT_COPYABLE'
  /** A copy costs more than the client's maximum bitrate beside every audio step. */
  | 'BITRATE_ABOVE_VIEWER_LIMIT'
  /** The copy of the format attempt before this one failed, so this one encodes the video. */
  | 'COPY_FAILED'
  /** An audio track of the file is one that no audio capability entry listing the file's source container accepts. */
  | 'DIRECT_PLAY_AUDIO_NOT_DECLARED'
  /**
   * The player cannot select an audio track inside a file that it direct-plays, and it would not start on the audio
   * track that the viewer chose: the viewer chose a later track, or the file marks another track as its default. The
   * format attempt that the viewer's audio switch moves from direct play to HLS names it too.
   */
  | 'DIRECT_PLAY_AUDIO_TRACK_NOT_SELECTABLE'
  /**
   * No video capability entry of the source's codec family lists the file's source container for direct play, or,
   * for a file with audio, no audio capability entry lists it.
   */
  | 'DIRECT_PLAY_CONTAINER_NOT_DECLARED'
  /** The direct play of the format attempt before this one failed, so this one plays over HLS. */
  | 'DIRECT_PLAY_FAILED'
  /**
   * No video capability entry that lists the MP4 or MOV container lists the video stream's sample entry, such as
   * hev1, or the probe stored no sample entry.
   */
  | 'DIRECT_PLAY_SAMPLE_ENTRY_NOT_DECLARED'
  /**
   * No video capability entry that lists the file's source container accepts every property of the video stream as
   * it is, or the probe left one of those properties unknown.
   */
  | 'DIRECT_PLAY_VIDEO_NOT_DECLARED'
  /** The source's Dolby Vision configuration claims another base than the source's transfer signals. */
  | 'DOLBY_VISION_COMPATIBILITY_DISAGREES_WITH_TRANSFER'
  /**
   * The Dolby Vision copy of the format attempt before this one failed, so this one copies the video with its Dolby
   * Vision stripped, or encodes it when the client or the workers rule that copy out.
   */
  | 'DOLBY_VISION_COPY_FAILED'
  /** The closest entry does not declare the source's Dolby Vision profile and level. */
  | 'DOLBY_VISION_NOT_DECLARED'
  /** The probe found no Dolby Vision profile or level for the source, so no entry can accept its Dolby Vision. */
  | 'DOLBY_VISION_PROFILE_OR_LEVEL_UNKNOWN'
  /** The source's Dolby Vision RPUs start their samples, so a copy or direct play would hand players misplaced RPUs. */
  | 'DOLBY_VISION_RPU_STARTS_SAMPLE'
  /** The closest entry does not declare the source's compatible base: SDR, PQ or HLG. */
  | 'DYNAMIC_RANGE_NOT_DECLARED'
  /** The encode of the format attempt before this one failed, so this one encodes in another codec family. */
  | 'ENCODE_FAILED'
  /** A forced image subtitle track, PGS, VobSub or DVB, is in the language of an audio track. */
  | 'FORCED_IMAGE_SUBTITLE_IN_AUDIO_LANGUAGE'
  /** The source is H.264 at another bit depth or chroma subsampling than 8-bit 4:2:0. */
  | 'H264_NOT_8_BIT_4_2_0'
  /**
   * The hardware encoder of the format attempt before this one failed, so this one encodes the same codec family with
   * the software encoder. That format attempt does not count against maximumFormatAttempts (ADR 0044).
   */
  | 'HARDWARE_ENCODER_FAILED'
  /** The closest entry does not declare HDR10+. */
  | 'HDR10_PLUS_NOT_DECLARED'
  /** A copy that keeps Dolby Vision strips the source's HDR10+ information, whatever the client declares. */
  | 'HDR10_PLUS_STRIPPED_BESIDE_DOLBY_VISION'
  /** No source keyframe lies between the start and the end of the media, so no copied segment opens. */
  | 'KEYFRAMES_TOO_SPARSE'
  /** The source's keyframe positions are not known yet. */
  | 'KEYFRAMES_UNKNOWN'
  /** The source's keyframe timestamps go backwards or out of range. */
  | 'KEYFRAME_TIMESTAMPS_INVALID'
  /** No connected worker can make the copy's planned output. */
  | 'NO_WORKER_DELIVERS_COPY'
  /** The source's picture is larger than the fixed quality or the maximum size that the client sent. */
  | 'PICTURE_ABOVE_VIEWER_LIMIT'
  /** The source's sample entry is not one under which a playlist describes a copy, such as hev1. */
  | 'SAMPLE_ENTRY_NOT_COPYABLE'
  /** A copied segment, with the audio beside it, would be larger than a segment may be. */
  | 'SEGMENT_EXCEEDS_CAP'
  /** The probe found no single source container that a client can declare for direct play. */
  | 'SOURCE_CONTAINER_UNKNOWN'
  /** The source is interlaced. HLS delivery needs progressive video, and direct play of an interlaced file is unmeasured. */
  | 'SOURCE_INTERLACED'
  /** The probe stored no start time correction for the source's container, which a copy needs to start its segments at the source's keyframes. */
  | 'START_TIME_CORRECTION_UNKNOWN'
  /** The source's bit depth is above the closest entry's maximum. */
  | 'VIDEO_BIT_DEPTH_NOT_DECLARED'
  /** The probe reported no bit depth for the source's video, so no entry can accept a copy. */
  | 'VIDEO_BIT_DEPTH_UNKNOWN'
  /** The probe reported no chroma subsampling for the source's H.264 video. */
  | 'VIDEO_CHROMA_SUBSAMPLING_UNKNOWN'
  /** The source's codec level or tier is above the closest entry's maximum for its profile. */
  | 'VIDEO_CODEC_LEVEL_NOT_DECLARED'
  /** No video capability entry for HLS names the source's codec family. */
  | 'VIDEO_CODEC_NOT_DECLARED'
  /** The closest entry does not list the source's codec profile. */
  | 'VIDEO_CODEC_PROFILE_NOT_DECLARED'
  /** The probe could not name the source's codec profile. */
  | 'VIDEO_CODEC_PROFILE_UNKNOWN'
  /** The probe stored no codec string for the source's video, which a playlist needs to describe a copy. */
  | 'VIDEO_CODEC_STRING_UNKNOWN'
  /** The probe reported no codec name for the source's video. */
  | 'VIDEO_CODEC_UNKNOWN'
  /** The source's video ends at least one segment before another stream of the source, so the encode holds its last frame to the end. */
  | 'VIDEO_ENDS_EARLY'
  /** The source's frame rate is above the closest entry's maximum. */
  | 'VIDEO_FRAME_RATE_NOT_DECLARED'
  /** The source's picture is larger than the closest entry's maximum. */
  | 'VIDEO_PICTURE_SIZE_NOT_DECLARED'
  /** The source's HDR base was probed before the probe described its codec profile. */
  | 'VIDEO_PROPERTIES_NOT_PROBED'
  /** The probe stored no video facts for a copy. */
  | 'VIDEO_SOURCE_NOT_COPYABLE'
  /** The viewer chose SDR in a fixed quality, and a copy would keep the source's HDR range, so the server encodes SDR. */
  | 'VIEWER_CHOSE_SDR'
  | '%future added value';

/** A standard picture format that a player displays without a stream's advanced HDR information. */
export type DeclaredCompatibleBase =
  /** Hybrid log-gamma, ARIB STD-B67. */
  | 'HLG'
  /** SMPTE ST 2084, which covers HDR10 and PQ10. */
  | 'PQ'
  /** Standard dynamic range. */
  | 'SDR'
  | '%future added value';

export type DestroyPlaybackSessionInput = {
  playbackSessionId: string | number;
};

export type DeviceRegistrationStatus =
  | 'ACTIVE'
  | 'REVOKED'
  | '%future added value';

export type DolbyVisionEnhancementLayer =
  | 'FEL'
  | 'MEL'
  | 'NONE'
  | 'UNSPECIFIED'
  | '%future added value';

/** A single-layer Dolby Vision profile. No value names profile 7, which needs dual-layer playback. */
export type DolbyVisionProfile =
  | 'PROFILE_5'
  | 'PROFILE_8_1'
  | 'PROFILE_8_4'
  | 'PROFILE_10_0'
  | 'PROFILE_10_1'
  | 'PROFILE_10_4'
  | '%future added value';

/** A Dolby Vision profile whose RPUs the player applies, with the highest Dolby Vision level it accepts for that profile. */
export type DolbyVisionProfileCapabilityInput = {
  /** The highest Dolby Vision level, which is separate from the codec level. */
  maxLevel: number;
  /** The Dolby Vision profile. Profiles 5 and 8.x belong to HEVC entries, and profiles 10.x to AV1 entries. */
  profile: DolbyVisionProfile;
};

/** The viewer's HDR choice in a fixed quality. */
export type DynamicRangeChoice =
  /** Keep the source's HDR range when the client declares it. */
  | 'HDR'
  /** Play an HDR source as an SDR encode. */
  | 'SDR'
  | '%future added value';

/** A preset on the scale that every software encoder uses, from fastest to slowest. */
export type EncoderPreset =
  | 'FAST'
  | 'FASTER'
  | 'MEDIUM'
  | 'SLOW'
  | 'SLOWER'
  | 'SUPERFAST'
  | 'VERYFAST'
  | 'VERYSLOW'
  | '%future added value';

/** Automatic, or one fixed preset from the scale. */
export type EncoderPresetChoice =
  | 'AUTOMATIC'
  | 'FAST'
  | 'FASTER'
  | 'MEDIUM'
  | 'SLOW'
  | 'SLOWER'
  | 'SUPERFAST'
  | 'VERYFAST'
  | 'VERYSLOW'
  | '%future added value';

export type EndProfileShareInput = {
  shareId: string | number;
};

export type ExternalAgentStrategy =
  | 'TMDB'
  | '%future added value';

export type HouseholdRole =
  | 'ADMIN'
  | 'MEMBER'
  | '%future added value';

export type ImageRefreshMode =
  | 'FORCE_REFRESH'
  | 'PRESERVE'
  | 'REFRESH_IF_CHANGED'
  | '%future added value';

export type ImageSize =
  | 'LARGE'
  | 'MEDIUM'
  | 'ORIGINAL'
  | 'SMALL'
  | '%future added value';

export type IssueShareCodeInput = {
  householdId: string | number;
};

/**
 * A language that a Profile's language preferences name (ADR 0043). Each value's description is
 * its BCP 47 tag. The server maps each value to the codes that files tag a stream with, such as
 * fr, fra and fre for FR. A tag with a region or script that has no value of its own, such as
 * pt-PT, reads as its base language.
 */
export type Language =
  /** aa */
  | 'AA'
  /** ab */
  | 'AB'
  /** ae */
  | 'AE'
  /** af */
  | 'AF'
  /** ak */
  | 'AK'
  /** am */
  | 'AM'
  /** an */
  | 'AN'
  /** ar */
  | 'AR'
  /** as */
  | 'AS'
  /** av */
  | 'AV'
  /** ay */
  | 'AY'
  /** az */
  | 'AZ'
  /** ba */
  | 'BA'
  /** be */
  | 'BE'
  /** bg */
  | 'BG'
  /** bi */
  | 'BI'
  /** bm */
  | 'BM'
  /** bn */
  | 'BN'
  /** bo */
  | 'BO'
  /** br */
  | 'BR'
  /** bs */
  | 'BS'
  /** ca */
  | 'CA'
  /** ce */
  | 'CE'
  /** ch */
  | 'CH'
  /** co */
  | 'CO'
  /** cr */
  | 'CR'
  /** cs */
  | 'CS'
  /** cu */
  | 'CU'
  /** cv */
  | 'CV'
  /** cy */
  | 'CY'
  /** da */
  | 'DA'
  /** de */
  | 'DE'
  /** dv */
  | 'DV'
  /** dz */
  | 'DZ'
  /** ee */
  | 'EE'
  /** el */
  | 'EL'
  /** en */
  | 'EN'
  /** eo */
  | 'EO'
  /** es */
  | 'ES'
  /** es-419 */
  | 'ES_419'
  /** et */
  | 'ET'
  /** eu */
  | 'EU'
  /** fa */
  | 'FA'
  /** ff */
  | 'FF'
  /** fi */
  | 'FI'
  /** fj */
  | 'FJ'
  /** fo */
  | 'FO'
  /** fr */
  | 'FR'
  /** fy */
  | 'FY'
  /** ga */
  | 'GA'
  /** gd */
  | 'GD'
  /** gl */
  | 'GL'
  /** gn */
  | 'GN'
  /** gu */
  | 'GU'
  /** gv */
  | 'GV'
  /** ha */
  | 'HA'
  /** he */
  | 'HE'
  /** hi */
  | 'HI'
  /** ho */
  | 'HO'
  /** hr */
  | 'HR'
  /** ht */
  | 'HT'
  /** hu */
  | 'HU'
  /** hy */
  | 'HY'
  /** hz */
  | 'HZ'
  /** ia */
  | 'IA'
  /** id */
  | 'ID'
  /** ie */
  | 'IE'
  /** ig */
  | 'IG'
  /** ii */
  | 'II'
  /** ik */
  | 'IK'
  /** io */
  | 'IO'
  /** is */
  | 'IS'
  /** it */
  | 'IT'
  /** iu */
  | 'IU'
  /** ja */
  | 'JA'
  /** jv */
  | 'JV'
  /** ka */
  | 'KA'
  /** kg */
  | 'KG'
  /** ki */
  | 'KI'
  /** kj */
  | 'KJ'
  /** kk */
  | 'KK'
  /** kl */
  | 'KL'
  /** km */
  | 'KM'
  /** kn */
  | 'KN'
  /** ko */
  | 'KO'
  /** kr */
  | 'KR'
  /** ks */
  | 'KS'
  /** ku */
  | 'KU'
  /** kv */
  | 'KV'
  /** kw */
  | 'KW'
  /** ky */
  | 'KY'
  /** la */
  | 'LA'
  /** lb */
  | 'LB'
  /** lg */
  | 'LG'
  /** li */
  | 'LI'
  /** ln */
  | 'LN'
  /** lo */
  | 'LO'
  /** lt */
  | 'LT'
  /** lu */
  | 'LU'
  /** lv */
  | 'LV'
  /** mg */
  | 'MG'
  /** mh */
  | 'MH'
  /** mi */
  | 'MI'
  /** mk */
  | 'MK'
  /** ml */
  | 'ML'
  /** mn */
  | 'MN'
  /** mr */
  | 'MR'
  /** ms */
  | 'MS'
  /** mt */
  | 'MT'
  /** my */
  | 'MY'
  /** na */
  | 'NA'
  /** nb */
  | 'NB'
  /** nd */
  | 'ND'
  /** ne */
  | 'NE'
  /** ng */
  | 'NG'
  /** nl */
  | 'NL'
  /** nn */
  | 'NN'
  /** no */
  | 'NO'
  /** nr */
  | 'NR'
  /** nv */
  | 'NV'
  /** ny */
  | 'NY'
  /** oc */
  | 'OC'
  /** oj */
  | 'OJ'
  /** om */
  | 'OM'
  /** or */
  | 'OR'
  /** os */
  | 'OS'
  /** pa */
  | 'PA'
  /** pi */
  | 'PI'
  /** pl */
  | 'PL'
  /** ps */
  | 'PS'
  /** pt */
  | 'PT'
  /** pt-BR */
  | 'PT_BR'
  /** qu */
  | 'QU'
  /** rm */
  | 'RM'
  /** rn */
  | 'RN'
  /** ro */
  | 'RO'
  /** ru */
  | 'RU'
  /** rw */
  | 'RW'
  /** sa */
  | 'SA'
  /** sc */
  | 'SC'
  /** sd */
  | 'SD'
  /** se */
  | 'SE'
  /** sg */
  | 'SG'
  /** si */
  | 'SI'
  /** sk */
  | 'SK'
  /** sl */
  | 'SL'
  /** sm */
  | 'SM'
  /** sn */
  | 'SN'
  /** so */
  | 'SO'
  /** sq */
  | 'SQ'
  /** sr */
  | 'SR'
  /** ss */
  | 'SS'
  /** st */
  | 'ST'
  /** su */
  | 'SU'
  /** sv */
  | 'SV'
  /** sw */
  | 'SW'
  /** ta */
  | 'TA'
  /** te */
  | 'TE'
  /** tg */
  | 'TG'
  /** th */
  | 'TH'
  /** ti */
  | 'TI'
  /** tk */
  | 'TK'
  /** tl */
  | 'TL'
  /** tn */
  | 'TN'
  /** to */
  | 'TO'
  /** tr */
  | 'TR'
  /** ts */
  | 'TS'
  /** tt */
  | 'TT'
  /** tw */
  | 'TW'
  /** ty */
  | 'TY'
  /** ug */
  | 'UG'
  /** uk */
  | 'UK'
  /** ur */
  | 'UR'
  /** uz */
  | 'UZ'
  /** ve */
  | 'VE'
  /** vi */
  | 'VI'
  /** vo */
  | 'VO'
  /** wa */
  | 'WA'
  /** wo */
  | 'WO'
  /** xh */
  | 'XH'
  /** yi */
  | 'YI'
  /** yo */
  | 'YO'
  /** za */
  | 'ZA'
  /** zh */
  | 'ZH'
  /** zh-Hans */
  | 'ZH_HANS'
  /** zh-Hant */
  | 'ZH_HANT'
  /** zu */
  | 'ZU'
  | '%future added value';

export type LibraryBackend =
  | 'LOCAL'
  | 'REMOTE'
  | '%future added value';

export type LibraryStatus =
  | 'HEALTHY'
  | 'REFRESHING'
  | 'SCANNING'
  /** A ServerAdmin stopped the library's scan or refresh. Its admitted tasks finish, and then the library returns to the status it had before the scan or refresh started. */
  | 'STOPPING'
  | 'UNHEALTHY'
  | '%future added value';

export type LookUpShareCodeInput = {
  /** The code as the person typed it. Case, spaces and the hyphen do not matter. */
  code: string;
};

export type MarkNotificationsReadInput = {
  /**
   * The ids of the rows that the client's page showed, from 1 to 100. An id that does not exist,
   * that is another Account's or that is already read is skipped, with no error.
   */
  notificationIds: Array<string | number>;
};

export type MarkUnwatchedInput = {
  /** The ID of a movie, episode, season or series. */
  itemId: string | number;
};

export type MarkWatchedInput = {
  /** The ID of a movie, episode, season or series. */
  itemId: string | number;
};

export type MediaFilter = {
  castMemberIds?: Array<string | number> | null | undefined;
  contentRatings?: Array<string> | null | undefined;
  directorIds?: Array<string | number> | null | undefined;
  genreIds?: Array<string | number> | null | undefined;
  startLetter?: AlphabetLetter | null | undefined;
  studioIds?: Array<string | number> | null | undefined;
  unmatched?: boolean | null | undefined;
  watchStatus?: WatchStatus | null | undefined;
  years?: Array<number> | null | undefined;
};

export type MediaSort = {
  by?: OrderMediaBy | null | undefined;
  direction?: SortDirection | null | undefined;
};

export type MediaType =
  | 'MOVIE'
  | 'OTHER'
  | 'SERIES'
  | '%future added value';

export type MetadataPresence =
  | 'ABSENT'
  | 'PRESENT'
  | 'UNSPECIFIED'
  | '%future added value';

export type OfferProfileShareInput = {
  profileId: string | number;
  /** The share code the target Household gave out. It names the Household, and the offer spends it. */
  shareCode: string;
};

export type OrderMediaBy =
  | 'ADDED'
  | 'LAST_WATCHED'
  | 'RELEASE_DATE'
  | 'RUNTIME'
  | 'TITLE'
  | '%future added value';

/** How a format attempt delivers one track. */
export type PlaybackDelivery =
  /** A stream copy of the source's track. */
  | 'COPY'
  /** The source file as it is, without HLS. */
  | 'DIRECT_PLAY'
  /** An encode of the source's track. */
  | 'ENCODE'
  | '%future added value';

/** Why the output differs from the output that the requested playback choice asked for (ADR 0052). */
export type PlaybackFormatChange =
  /** The viewer switched audio tracks during direct play and the server rules out the HLS copy. An encode plays. */
  | 'AUDIO_TRACK_SWITCHED'
  /** An HLS copy failed: the player refused it, the worker could not make it, or it ran short while a source stream still had media. An encode plays. */
  | 'COPY_FAILED'
  /** Direct play failed and the server rules out the HLS copy. An encode plays. */
  | 'DIRECT_PLAY_FAILED'
  /** A Dolby Vision copy failed, so the same copy without Dolby Vision plays on the source's PQ or HLG base. */
  | 'DOLBY_VISION_STRIPPED'
  /** Original could neither direct-play nor copy the source, so its first format attempt is an encode. */
  | 'STARTED_WITH_ENCODE'
  | '%future added value';

export type PlaybackFormatFailure =
  | 'DECODE_ERROR'
  | 'UNSUPPORTED_FORMAT'
  | '%future added value';

export type PlaybackState =
  | 'PAUSED'
  | 'PLAYING'
  | 'STOPPED'
  | '%future added value';

/** The level that a language preference comes from. */
export type PreferenceSource =
  /** The Profile's own preferences. */
  | 'PROFILE'
  /** The Profile's override for the season. */
  | 'SEASON'
  /** The Profile's override for the series. */
  | 'SERIES'
  /** The Profile's override for the episode or the movie itself. */
  | 'TITLE'
  | '%future added value';

export type ProfileKind =
  | 'ADULT'
  | 'KID'
  | '%future added value';

export type ProfileShareAnswer =
  | 'ACCEPTED'
  | 'REJECTED'
  | '%future added value';

export type ProfileShareStatus =
  /** The Profile is available in the Household. */
  | 'ACTIVE'
  /** Withdrawn by the offerer, or replaced by a newer offer. */
  | 'CANCELED'
  /** Ended after being active. */
  | 'ENDED'
  /** Timed out before a decision. */
  | 'EXPIRED'
  /** Withdrawn by the system because the offer could no longer stand, as when its offerer lost authority or its Profile was transferred; invalidationReason says why. */
  | 'INVALIDATED'
  /** Offered and awaiting the target Household's decision. */
  | 'PENDING'
  /** Declined by the target Household. */
  | 'REJECTED'
  | '%future added value';

export type RejectProfileShareInput = {
  shareId: string | number;
};

export type RemoveLibraryInput = {
  libraryId: string | number;
};

export type ReportPlaybackFormatFailureInput = {
  playbackSessionId: string | number;
  /** A player error about the media format itself. Network, server, file and authorization errors are not format failures. */
  reason: PlaybackFormatFailure;
  streamSessionId: string | number;
};

export type RequestResolution =
  /** Someone with the authority accepted, rejected or declined the subject. */
  | 'DECIDED'
  /** The subject's expiry passed with no decision. */
  | 'EXPIRED'
  /** The proposer canceled the subject, a newer proposal replaced it, or the server invalidated it. */
  | 'WITHDRAWN'
  | '%future added value';

export type RevokeDeviceRegistrationInput = {
  registrationId: string | number;
};

/**
 * Each language field that the input leaves out keeps the stored value. A field set to null
 * inherits from the next wider level: the season, then the series, then the Profile. An override
 * whose every field inherits is removed. A switch in the player sets the override of that episode
 * or movie only, and never the season's or the series', so the next episode starts from the wider
 * levels again. A settings screen sets the override of its own level.
 */
export type SetLanguageOverrideInput = {
  audioLanguage?: Language | null | undefined;
  /** The ID of a series, a season, an episode or a movie. */
  itemId: string | number;
  subtitleLanguage?: Language | null | undefined;
  subtitleMode?: SubtitleMode | null | undefined;
};

export type SetLanguagePreferencesInput = {
  /** At most five languages, none twice, in order of preference. */
  audioLanguages: Array<Language>;
  subtitleLanguage?: Language | null | undefined;
  subtitleMode: SubtitleMode;
};

export type ShareCodeStatus =
  /** Timed out before an offer presented it. */
  | 'EXPIRED'
  /**
   * Withdrawn by the system because the Account that issued it may no longer issue a share code for
   * the Household, as a HouseholdAdmin of it or as ServerAdmin, or was disabled or deleted.
   */
  | 'INVALIDATED'
  /** The code still works: an offer may present it until it expires. */
  | 'LIVE'
  /** An offer presented the code. A code admits one offer. */
  | 'SPENT'
  /** Withdrawn by a HouseholdAdmin of the Household or by a ServerAdmin. */
  | 'WITHDRAWN'
  | '%future added value';

export type SortDirection =
  | 'ASC'
  | 'DESC'
  | '%future added value';

/**
 * The container of a media file as the probe found it. Direct play sends the file in this container,
 * with this container's media type.
 */
export type SourceContainer =
  /** The Advanced Systems Format, as in WMV files. */
  | 'ASF'
  /** Audio Video Interleave. */
  | 'AVI'
  /** Flash Video. */
  | 'FLV'
  /** Matroska, including WebM. */
  | 'MATROSKA'
  /** The QuickTime file format: a file whose major brand is QuickTime's qt. */
  | 'MOV'
  /** MPEG-4 Part 14: a file whose major brand is not QuickTime's, including M4V and 3GP files, or a file without a major brand. */
  | 'MP4'
  /** The MPEG-2 program stream, as in MPG and VOB files. */
  | 'MPEG_PS'
  /** The MPEG-2 transport stream, including M2TS. */
  | 'MPEG_TS'
  | '%future added value';

export type StartLibraryRefreshInput = {
  imageRefreshMode?: ImageRefreshMode;
  libraryId: string | number;
};

export type StartLibraryScanInput = {
  libraryId: string | number;
};

export type StopLibraryRefreshInput = {
  libraryId: string | number;
};

export type StopLibraryScanInput = {
  libraryId: string | number;
};

/** The viewer's playback choices. What the client can play belongs in the client capability declaration. */
export type StreamingOptionsInput = {
  /** The audio language of this session. It wins over the Profile's language preferences and overrides. */
  audioLanguage?: Language | null | undefined;
  /**
   * The viewer's HDR choice (ADR 0013). Only a fixed quality takes it: SDR plays an HDR source as an SDR encode,
   * and HDR keeps the source's HDR range when the client declares it. Auto and Original ignore it. Null for no
   * choice, which keeps the source's HDR range when the client declares it. The stream session's videoRange
   * names the range that plays. When the viewer switches from Auto to a fixed quality, the client sends the
   * range that plays, HDR or SDR, so the switch keeps the picture: SDR after Auto gave HDR up for SDR.
   */
  dynamicRange?: DynamicRangeChoice | null | undefined;
  maxBitrate?: number | null | undefined;
  maxHeight?: number | null | undefined;
  maxWidth?: number | null | undefined;
  quality?: VideoQuality | null | undefined;
  /** The subtitle language of this session. Stored now; subtitles apply when they ship. */
  subtitleLanguage?: Language | null | undefined;
};

/** When a subtitle track starts on. */
export type SubtitleMode =
  /** The track in the subtitle language, whatever the audio. */
  | 'ALWAYS'
  /** Only a forced track whose language matches the selected audio. The default. */
  | 'FORCED'
  /** No subtitle track, not even a forced track. */
  | 'OFF'
  | '%future added value';

export type SwitchPlaybackAudioTrackInput = {
  /**
   * The audio track that the viewer chose: its position, counting from 0, among the file's audio tracks in
   * stream order, as DirectPlayStreamSession.audioTrackPosition counts.
   */
  audioTrackPosition: number;
  playbackSessionId: string | number;
  /** The direct-play stream session that plays now. */
  streamSessionId: string | number;
};

export type TranscodeMode =
  | 'AUDIO_TRANSCODE'
  | 'FULL_TRANSCODE'
  | 'REMUX'
  | 'VIDEO_TRANSCODE'
  | '%future added value';

/**
 * One group of video values and maximums that the player accepts together for one codec family. The
 * player accepts every combination that takes one value from each list and stays within every
 * maximum. A client whose limits depend on each other sends one entry for each combination of limits.
 */
export type VideoCapabilityEntryInput = {
  /** The codec family that every codec profile of this entry belongs to. */
  codecFamily: VideoCodecFamily;
  /** The codec profiles that the player decodes, each with its own maximum level and tier. The entry needs at least one. */
  codecProfiles: Array<VideoCodecProfileCapabilityInput>;
  /** The compatible bases that the player displays. The entry needs at least one unless it lists Dolby Vision profile 5 or 10.0, whose streams have no compatible base. */
  compatibleBases: Array<DeclaredCompatibleBase>;
  /** The source containers from which the player opens a stream that this entry accepts, by direct play. An entry that does not apply to HLS lists at least one. */
  directPlayContainers?: Array<SourceContainer>;
  /** The sample entries that the player opens from MP4 or MOV by direct play. An entry that lists MP4 or MOV lists at least one, and the player plays each listed sample entry from a real test file. An MP4 or MOV file plays directly only when its video stream's sample entry is listed. The other source containers store no sample entry. */
  directPlaySampleEntries?: Array<VideoSampleEntry>;
  /** The Dolby Vision profiles whose RPUs the player applies. A player that plays only a stream's base layer lists none. */
  dolbyVisionProfiles: Array<DolbyVisionProfileCapabilityInput>;
  /** Whether the player applies HDR10+ information. */
  hdr10Plus: boolean;
  /** Whether this entry applies to HLS delivery. */
  hls: boolean;
  /** The highest bit depth that the player decodes. */
  maxBitDepth: number;
  /** The highest frame rate, in frames per second, that the player decodes. */
  maxFrameRate: number;
  /** The tallest picture, in pixels, that the player decodes. */
  maxHeight: number;
  /** The widest picture, in pixels, that the player decodes. */
  maxWidth: number;
};

/** A video codec family that a client can declare. */
export type VideoCodecFamily =
  | 'AV1'
  | 'H264'
  | 'HEVC'
  | '%future added value';

/** A video codec profile. Each value belongs to the codec family that its prefix names. */
export type VideoCodecProfile =
  | 'AV1_HIGH'
  | 'AV1_MAIN'
  | 'AV1_PROFESSIONAL'
  | 'H264_BASELINE'
  | 'H264_CONSTRAINED_BASELINE'
  | 'H264_EXTENDED'
  | 'H264_HIGH'
  | 'H264_HIGH_10'
  | 'H264_HIGH_422'
  | 'H264_HIGH_444_PREDICTIVE'
  | 'H264_MAIN'
  | 'HEVC_FORMAT_RANGE_EXTENSIONS'
  | 'HEVC_MAIN'
  | 'HEVC_MAIN_10'
  | 'HEVC_MAIN_STILL_PICTURE'
  | '%future added value';

/** A codec profile that the player decodes, with the highest level and tier it accepts for that profile. */
export type VideoCodecProfileCapabilityInput = {
  /** The highest codec level, written as the major level × 10 plus the minor level for every codec family: level 5.1 is 51. */
  maxLevel: number;
  /** The highest codec tier. Required for HEVC and AV1 profiles, and absent for H.264 profiles, which have no tier. */
  maxTier?: VideoCodecTier | null | undefined;
  /** The codec profile, which must belong to the entry's codec family. */
  profile: VideoCodecProfile;
};

/** The tier of an HEVC or AV1 stream. The High tier is above the Main tier. */
export type VideoCodecTier =
  | 'HIGH'
  | 'MAIN'
  | '%future added value';

export type VideoQuality =
  | 'AUTO'
  | 'FULL_HD_1080P'
  | 'HIGH_720P'
  | 'LOW_360P'
  | 'MEDIUM_480P'
  | 'ORIGINAL'
  | 'UHD_4K'
  | '%future added value';

/** The dynamic range of a stream session's video, as an HLS playlist's VIDEO-RANGE attribute names it. */
export type VideoRange =
  /** Hybrid log-gamma, ARIB STD-B67. */
  | 'HLG'
  /** SMPTE ST 2084, which covers HDR10, PQ10 and the PQ base of Dolby Vision. */
  | 'PQ'
  | 'SDR'
  | '%future added value';

/** A sample entry: the four characters that name a video stream's coding format in an MP4 or MOV file. */
export type VideoSampleEntry =
  /** AV1: av01. */
  | 'AV01'
  /** H.264 with its parameter sets in the sample entry: avc1. */
  | 'AVC1'
  /** H.264 with its parameter sets allowed in the samples: avc3. */
  | 'AVC3'
  /** Dolby Vision over AV1: dav1. */
  | 'DAV1'
  /** Dolby Vision over H.264 with its parameter sets in the sample entry: dva1. */
  | 'DVA1'
  /** Dolby Vision over H.264 with its parameter sets allowed in the samples: dvav. */
  | 'DVAV'
  /** Dolby Vision over HEVC with its parameter sets in the sample entry: dvh1. */
  | 'DVH1'
  /** Dolby Vision over HEVC with its parameter sets allowed in the samples: dvhe. */
  | 'DVHE'
  /** HEVC with its parameter sets allowed in the samples: hev1. */
  | 'HEV1'
  /** HEVC with its parameter sets in the sample entry: hvc1. */
  | 'HVC1'
  | '%future added value';

export type WatchStatus =
  | 'IN_PROGRESS'
  | 'UNWATCHED'
  | 'WATCHED'
  | '%future added value';

export type WithdrawShareCodeInput = {
  shareCodeId: string | number;
};

export type EncoderPresetSettingFieldsFragment = { __typename: 'EncoderPresetSetting', preset: EncoderPresetChoice, automatic: { __typename: 'AutomaticEncoderPresets', h264: EncoderPreset, hevc: EncoderPreset, av1: EncoderPreset } };

export type EncoderPresetSettingQueryVariables = Exact<{ [key: string]: never; }>;


export type EncoderPresetSettingQuery = { encoderPresetSetting: { __typename: 'EncoderPresetSetting', preset: EncoderPresetChoice, automatic: { __typename: 'AutomaticEncoderPresets', h264: EncoderPreset, hevc: EncoderPreset, av1: EncoderPreset } } };

export type ChangeEncoderPresetMutationVariables = Exact<{
  input: ChangeEncoderPresetInput;
}>;


export type ChangeEncoderPresetMutation = { changeEncoderPreset: { encoderPresetSetting: { __typename: 'EncoderPresetSetting', preset: EncoderPresetChoice, automatic: { __typename: 'AutomaticEncoderPresets', h264: EncoderPreset, hevc: EncoderPreset, av1: EncoderPreset } } | null, userErrors: Array<{ __typename: 'UnknownEncoderPresetError', message: string, inputPath: Array<string> }> } | null };

export type IdleSegmentRetentionSettingFieldsFragment = { __typename: 'IdleSegmentRetentionSetting', id: string, minutes: number, minimumMinutes: number, maximumMinutes: number };

export type IdleSegmentRetentionSettingQueryVariables = Exact<{ [key: string]: never; }>;


export type IdleSegmentRetentionSettingQuery = { idleSegmentRetentionSetting: { __typename: 'IdleSegmentRetentionSetting', id: string, minutes: number, minimumMinutes: number, maximumMinutes: number } };

export type ChangeIdleSegmentRetentionMutationVariables = Exact<{
  input: ChangeIdleSegmentRetentionInput;
}>;


export type ChangeIdleSegmentRetentionMutation = { changeIdleSegmentRetention: { idleSegmentRetentionSetting: { __typename: 'IdleSegmentRetentionSetting', id: string, minutes: number, minimumMinutes: number, maximumMinutes: number } | null, userErrors: Array<{ __typename: 'IdleSegmentRetentionOutOfRangeError', message: string, inputPath: Array<string> }> } | null };

export type AdminLibrariesQueryVariables = Exact<{ [key: string]: never; }>;


export type AdminLibrariesQuery = { libraries: Array<{ __typename: 'Library', id: string, name: string | null, type: MediaType, backend: LibraryBackend, administration: { filepathUri: string, status: LibraryStatus, scanStartedOn: string | null, scanCompletedOn: string | null } | null }> };

export type AddLibraryMutationVariables = Exact<{
  input: AddLibraryInput;
}>;


export type AddLibraryMutation = { addLibrary: { library: { __typename: 'Library', id: string, name: string | null, type: MediaType, backend: LibraryBackend, administration: { filepathUri: string, status: LibraryStatus, scanStartedOn: string | null, scanCompletedOn: string | null } | null } | null, userErrors: Array<
      | { __typename: 'LibraryNameRequiredError', message: string, inputPath: Array<string> }
      | { __typename: 'LibraryPathAlreadyRegisteredError', message: string, inputPath: Array<string> }
      | { __typename: 'LibraryPathNotDirectoryError', message: string, inputPath: Array<string> }
      | { __typename: 'LibraryPathNotFoundError', message: string, inputPath: Array<string> }
      | { __typename: 'LibraryPathNotReadableError', message: string, inputPath: Array<string> }
      | { __typename: 'LibraryPathOutsideMediaRootError', message: string, inputPath: Array<string> }
      | { __typename: 'LibraryPathOverlapError', message: string, inputPath: Array<string> }
      | { __typename: 'LibraryPathRequiredError', message: string, inputPath: Array<string> }
      | { __typename: 'LibraryPathThroughSoftLinkError', message: string, inputPath: Array<string> }
    > } | null };

export type StartLibraryScanMutationVariables = Exact<{
  input: StartLibraryScanInput;
}>;


export type StartLibraryScanMutation = { startLibraryScan: { library: { __typename: 'Library', id: string, name: string | null, type: MediaType, backend: LibraryBackend, administration: { filepathUri: string, status: LibraryStatus, scanStartedOn: string | null, scanCompletedOn: string | null } | null } | null, userErrors: Array<
      | { __typename: 'InvalidIdError', message: string }
      | { __typename: 'LibraryBusyError', message: string, status: LibraryStatus }
      | { __typename: 'LibraryNotFoundError', message: string }
    > } | null };

export type StartLibraryRefreshMutationVariables = Exact<{
  input: StartLibraryRefreshInput;
}>;


export type StartLibraryRefreshMutation = { startLibraryRefresh: { library: { __typename: 'Library', id: string, name: string | null, type: MediaType, backend: LibraryBackend, administration: { filepathUri: string, status: LibraryStatus, scanStartedOn: string | null, scanCompletedOn: string | null } | null } | null, userErrors: Array<
      | { __typename: 'InvalidIdError', message: string }
      | { __typename: 'LibraryBusyError', message: string, status: LibraryStatus }
      | { __typename: 'LibraryNotFoundError', message: string }
    > } | null };

export type StopLibraryScanMutationVariables = Exact<{
  input: StopLibraryScanInput;
}>;


export type StopLibraryScanMutation = { stopLibraryScan: { library: { __typename: 'Library', id: string, name: string | null, type: MediaType, backend: LibraryBackend, administration: { filepathUri: string, status: LibraryStatus, scanStartedOn: string | null, scanCompletedOn: string | null } | null } | null, userErrors: Array<
      | { __typename: 'InvalidIdError', message: string }
      | { __typename: 'LibraryNotFoundError', message: string }
      | { __typename: 'LibraryScanNotInProgressError', message: string, status: LibraryStatus }
    > } | null };

export type StopLibraryRefreshMutationVariables = Exact<{
  input: StopLibraryRefreshInput;
}>;


export type StopLibraryRefreshMutation = { stopLibraryRefresh: { library: { __typename: 'Library', id: string, name: string | null, type: MediaType, backend: LibraryBackend, administration: { filepathUri: string, status: LibraryStatus, scanStartedOn: string | null, scanCompletedOn: string | null } | null } | null, userErrors: Array<
      | { __typename: 'InvalidIdError', message: string }
      | { __typename: 'LibraryNotFoundError', message: string }
      | { __typename: 'LibraryRefreshNotInProgressError', message: string, status: LibraryStatus }
    > } | null };

export type RemoveLibraryMutationVariables = Exact<{
  input: RemoveLibraryInput;
}>;


export type RemoveLibraryMutation = { removeLibrary: { removedLibraryId: string | null, userErrors: Array<
      | { __typename: 'InvalidIdError', message: string }
      | { __typename: 'LibraryBusyError', message: string, status: LibraryStatus }
      | { __typename: 'LibraryNotFoundError', message: string }
    > } | null };

export type NotificationRetentionSettingFieldsFragment = { __typename: 'NotificationRetentionSetting', id: string, days: number, minimumDays: number, maximumDays: number };

export type NotificationRetentionSettingQueryVariables = Exact<{ [key: string]: never; }>;


export type NotificationRetentionSettingQuery = { notificationRetentionSetting: { __typename: 'NotificationRetentionSetting', id: string, days: number, minimumDays: number, maximumDays: number } };

export type ChangeNotificationRetentionMutationVariables = Exact<{
  input: ChangeNotificationRetentionInput;
}>;


export type ChangeNotificationRetentionMutation = { changeNotificationRetention: { notificationRetentionSetting: { __typename: 'NotificationRetentionSetting', id: string, days: number, minimumDays: number, maximumDays: number } | null, userErrors: Array<{ __typename: 'NotificationRetentionOutOfRangeError', message: string }> } | null };

export type ActiveStreamsQueryVariables = Exact<{ [key: string]: never; }>;


export type ActiveStreamsQuery = { activeStreams: Array<{ playbackSessionId: string, deviceName: string | null, mediaFileId: string, positionSeconds: number | null, state: PlaybackState | null, workers: Array<string>, profile: { id: string, name: string | null }, media:
      | { __typename: 'Episode', id: string, title: string | null, episodeNumber: number, runtime: number | null, season: { id: string, seasonNumber: number, series: { id: string, title: string | null, images: Array<{ aspectRatio: number, blurHash: string | null, variants: Array<{ id: string, size: ImageSize, width: number, height: number, url: string } | null> } | null> } } }
      | { __typename: 'Movie', id: string, title: string | null, runtime: number | null, images: Array<{ aspectRatio: number, blurHash: string | null, variants: Array<{ id: string, size: ImageSize, width: number, height: number, url: string } | null> } | null> }
     | null, producedRange: { startSeconds: number, endSeconds: number } | null, decision: { formatAttempt: number, streamSessionId: string, reasons: Array<DecisionReason>, video: { delivery: PlaybackDelivery, source: { codec: string, width: number, height: number, frameRate: number | null, bitrate: number | null, videoRange: VideoRange, dolbyVision: boolean, details: { codecProfile: VideoCodecProfile | null, codecLevel: number | null, bitDepth: number | null, chromaSubsampling: ChromaSubsampling | null, compatibleBase: CompatibleBase, hdr10Plus: MetadataPresence, bitstreamRewrites: Array<BitstreamRewrite>, dolbyVision: { presence: MetadataPresence, profile: number | null, level: number | null, baseLayerCompatibilityId: number | null, enhancementLayer: DolbyVisionEnhancementLayer | null, observedRpu: MetadataPresence | null }, masteringDisplay: { minLuminance: number, maxLuminance: number } | null, contentLightLevel: { maxContentLightLevel: number, maxFrameAverageLightLevel: number } | null } | null }, output: { codec: string, width: number, height: number, frameRate: number | null, bitrate: number | null, videoRange: VideoRange, dolbyVision: boolean, details: { codecProfile: VideoCodecProfile | null, codecLevel: number | null, bitDepth: number | null, chromaSubsampling: ChromaSubsampling | null, compatibleBase: CompatibleBase, hdr10Plus: MetadataPresence, bitstreamRewrites: Array<BitstreamRewrite>, dolbyVision: { presence: MetadataPresence, profile: number | null, level: number | null, baseLayerCompatibilityId: number | null, enhancementLayer: DolbyVisionEnhancementLayer | null, observedRpu: MetadataPresence | null }, masteringDisplay: { minLuminance: number, maxLuminance: number } | null, contentLightLevel: { maxContentLightLevel: number, maxFrameAverageLightLevel: number } | null } | null } }, audio: { delivery: PlaybackDelivery, source: { codec: string, channels: number | null, bitrate: number | null }, output: { codec: string, channels: number | null, bitrate: number | null } } | null } | null }> };

export type ActiveStreamsChangedSubscriptionVariables = Exact<{ [key: string]: never; }>;


export type ActiveStreamsChangedSubscription = { activeStreamsChanged: { playbackSessionId: string, activeStream: { playbackSessionId: string, deviceName: string | null, mediaFileId: string, positionSeconds: number | null, state: PlaybackState | null, workers: Array<string>, profile: { id: string, name: string | null }, media:
        | { __typename: 'Episode', id: string, title: string | null, episodeNumber: number, runtime: number | null, season: { id: string, seasonNumber: number, series: { id: string, title: string | null, images: Array<{ aspectRatio: number, blurHash: string | null, variants: Array<{ id: string, size: ImageSize, width: number, height: number, url: string } | null> } | null> } } }
        | { __typename: 'Movie', id: string, title: string | null, runtime: number | null, images: Array<{ aspectRatio: number, blurHash: string | null, variants: Array<{ id: string, size: ImageSize, width: number, height: number, url: string } | null> } | null> }
       | null, producedRange: { startSeconds: number, endSeconds: number } | null, decision: { formatAttempt: number, streamSessionId: string, reasons: Array<DecisionReason>, video: { delivery: PlaybackDelivery, source: { codec: string, width: number, height: number, frameRate: number | null, bitrate: number | null, videoRange: VideoRange, dolbyVision: boolean, details: { codecProfile: VideoCodecProfile | null, codecLevel: number | null, bitDepth: number | null, chromaSubsampling: ChromaSubsampling | null, compatibleBase: CompatibleBase, hdr10Plus: MetadataPresence, bitstreamRewrites: Array<BitstreamRewrite>, dolbyVision: { presence: MetadataPresence, profile: number | null, level: number | null, baseLayerCompatibilityId: number | null, enhancementLayer: DolbyVisionEnhancementLayer | null, observedRpu: MetadataPresence | null }, masteringDisplay: { minLuminance: number, maxLuminance: number } | null, contentLightLevel: { maxContentLightLevel: number, maxFrameAverageLightLevel: number } | null } | null }, output: { codec: string, width: number, height: number, frameRate: number | null, bitrate: number | null, videoRange: VideoRange, dolbyVision: boolean, details: { codecProfile: VideoCodecProfile | null, codecLevel: number | null, bitDepth: number | null, chromaSubsampling: ChromaSubsampling | null, compatibleBase: CompatibleBase, hdr10Plus: MetadataPresence, bitstreamRewrites: Array<BitstreamRewrite>, dolbyVision: { presence: MetadataPresence, profile: number | null, level: number | null, baseLayerCompatibilityId: number | null, enhancementLayer: DolbyVisionEnhancementLayer | null, observedRpu: MetadataPresence | null }, masteringDisplay: { minLuminance: number, maxLuminance: number } | null, contentLightLevel: { maxContentLightLevel: number, maxFrameAverageLightLevel: number } | null } | null } }, audio: { delivery: PlaybackDelivery, source: { codec: string, channels: number | null, bitrate: number | null }, output: { codec: string, channels: number | null, bitrate: number | null } } | null } | null } | null } | null };

export type ActiveStreamFieldsFragment = { playbackSessionId: string, deviceName: string | null, mediaFileId: string, positionSeconds: number | null, state: PlaybackState | null, workers: Array<string>, profile: { id: string, name: string | null }, media:
    | { __typename: 'Episode', id: string, title: string | null, episodeNumber: number, runtime: number | null, season: { id: string, seasonNumber: number, series: { id: string, title: string | null, images: Array<{ aspectRatio: number, blurHash: string | null, variants: Array<{ id: string, size: ImageSize, width: number, height: number, url: string } | null> } | null> } } }
    | { __typename: 'Movie', id: string, title: string | null, runtime: number | null, images: Array<{ aspectRatio: number, blurHash: string | null, variants: Array<{ id: string, size: ImageSize, width: number, height: number, url: string } | null> } | null> }
   | null, producedRange: { startSeconds: number, endSeconds: number } | null, decision: { formatAttempt: number, streamSessionId: string, reasons: Array<DecisionReason>, video: { delivery: PlaybackDelivery, source: { codec: string, width: number, height: number, frameRate: number | null, bitrate: number | null, videoRange: VideoRange, dolbyVision: boolean, details: { codecProfile: VideoCodecProfile | null, codecLevel: number | null, bitDepth: number | null, chromaSubsampling: ChromaSubsampling | null, compatibleBase: CompatibleBase, hdr10Plus: MetadataPresence, bitstreamRewrites: Array<BitstreamRewrite>, dolbyVision: { presence: MetadataPresence, profile: number | null, level: number | null, baseLayerCompatibilityId: number | null, enhancementLayer: DolbyVisionEnhancementLayer | null, observedRpu: MetadataPresence | null }, masteringDisplay: { minLuminance: number, maxLuminance: number } | null, contentLightLevel: { maxContentLightLevel: number, maxFrameAverageLightLevel: number } | null } | null }, output: { codec: string, width: number, height: number, frameRate: number | null, bitrate: number | null, videoRange: VideoRange, dolbyVision: boolean, details: { codecProfile: VideoCodecProfile | null, codecLevel: number | null, bitDepth: number | null, chromaSubsampling: ChromaSubsampling | null, compatibleBase: CompatibleBase, hdr10Plus: MetadataPresence, bitstreamRewrites: Array<BitstreamRewrite>, dolbyVision: { presence: MetadataPresence, profile: number | null, level: number | null, baseLayerCompatibilityId: number | null, enhancementLayer: DolbyVisionEnhancementLayer | null, observedRpu: MetadataPresence | null }, masteringDisplay: { minLuminance: number, maxLuminance: number } | null, contentLightLevel: { maxContentLightLevel: number, maxFrameAverageLightLevel: number } | null } | null } }, audio: { delivery: PlaybackDelivery, source: { codec: string, channels: number | null, bitrate: number | null }, output: { codec: string, channels: number | null, bitrate: number | null } } | null } | null };

export type ActiveStreamPosterFieldsFragment = { aspectRatio: number, blurHash: string | null, variants: Array<{ id: string, size: ImageSize, width: number, height: number, url: string } | null> };

export type SharedWithHouseholdQueryVariables = Exact<{
  householdId: string | number;
}>;


export type SharedWithHouseholdQuery = { householdShares: { edges: Array<{ node: { id: string, profileId: string, householdId: string, status: ProfileShareStatus, requiredByAccountMembership: boolean, offeredByDisplayName: string | null, visitor: boolean | null, profile: { id: string, name: string, picture: string | null, kind: ProfileKind, personalProfile: boolean, restricted: boolean } | null } }> } };

export type VisitorShareFieldsFragment = { id: string, profileId: string, householdId: string, status: ProfileShareStatus, requiredByAccountMembership: boolean, offeredByDisplayName: string | null, visitor: boolean | null, profile: { id: string, name: string, picture: string | null, kind: ProfileKind, personalProfile: boolean, restricted: boolean } | null };

export type VisitorDevicesQueryVariables = Exact<{
  householdId: string | number;
}>;


export type VisitorDevicesQuery = { householdDevices: { edges: Array<{ node: { id: string, householdId: string | null, displayName: string, authorizingAccountDisplayName: string | null, status: DeviceRegistrationStatus, pairedAt: string } }> } };

export type RevokeDeviceRegistrationMutationVariables = Exact<{
  input: RevokeDeviceRegistrationInput;
}>;


export type RevokeDeviceRegistrationMutation = { revokeDeviceRegistration: { registrationId: string | null, userErrors: Array<
      | { __typename: 'RegistrationNotActiveError', message: string }
      | { __typename: 'RegistrationNotFoundError', message: string }
    > } | null };

export type LibrariesQueryVariables = Exact<{ [key: string]: never; }>;


export type LibrariesQuery = { libraries: Array<{ id: string, name: string | null, type: MediaType }> };

export type LibraryStatusChangedSubscriptionVariables = Exact<{ [key: string]: never; }>;


export type LibraryStatusChangedSubscription = { libraryStatusChanged: { __typename: 'Library', id: string, name: string | null, type: MediaType, backend: LibraryBackend, administration: { filepathUri: string, status: LibraryStatus, scanStartedOn: string | null, scanCompletedOn: string | null } | null } | null };

export type LibraryAddedSubscriptionVariables = Exact<{ [key: string]: never; }>;


export type LibraryAddedSubscription = { libraryAdded: { __typename: 'Library', id: string, name: string | null, type: MediaType, backend: LibraryBackend } | null };

export type AdminLibraryAddedSubscriptionVariables = Exact<{ [key: string]: never; }>;


export type AdminLibraryAddedSubscription = { libraryAdded: { __typename: 'Library', id: string, name: string | null, type: MediaType, backend: LibraryBackend, administration: { filepathUri: string, status: LibraryStatus, scanStartedOn: string | null, scanCompletedOn: string | null } | null } | null };

export type LibraryRemovedSubscriptionVariables = Exact<{ [key: string]: never; }>;


export type LibraryRemovedSubscription = { libraryRemoved: { libraryId: string } | null };

export type LibraryFieldsFragment = { __typename: 'Library', id: string, name: string | null, type: MediaType, backend: LibraryBackend };

export type AdminLibraryFieldsFragment = { __typename: 'Library', id: string, name: string | null, type: MediaType, backend: LibraryBackend, administration: { filepathUri: string, status: LibraryStatus, scanStartedOn: string | null, scanCompletedOn: string | null } | null };

export type MeQueryVariables = Exact<{ [key: string]: never; }>;


export type MeQuery = { me: { accountId: string, email: string, displayName: string, serverAdmin: boolean, scope: string, deviceBound: boolean, householdRole: HouseholdRole, household: { id: string, name: string }, contextHousehold: { id: string, name: string }, usableHouseholds: { edges: Array<{ node: { membership: boolean, household: { id: string, name: string } } }> }, selectableProfiles: { edges: Array<{ node: { id: string, name: string, picture: string | null, kind: ProfileKind, personal: boolean, pinConfigured: boolean, locked: boolean, selected: boolean } }> }, selectedProfile: { id: string, name: string } | null } };

export type ShareOffersQueryVariables = Exact<{
  householdId: string | number;
}>;


export type ShareOffersQuery = { householdShares: { edges: Array<{ node: { id: string, profileId: string, householdId: string, status: ProfileShareStatus, expiresAt: string | null, offeredByDisplayName: string | null, visitor: boolean | null, profile: { id: string, name: string, picture: string | null, kind: ProfileKind, personalProfile: boolean, restricted: boolean } | null } }> } };

export type ProfileSharesQueryVariables = Exact<{
  profileId: string | number;
  statuses: Array<ProfileShareStatus> | ProfileShareStatus;
}>;


export type ProfileSharesQuery = { profileShares: { edges: Array<{ node: { id: string, householdId: string, status: ProfileShareStatus, requiredByAccountMembership: boolean, expiresAt: string | null, endedAt: string | null, invalidationReason: string | null, household: { id: string, name: string } | null } }> } };

export type ProfileSharePreviewQueryVariables = Exact<{
  profileId: string | number;
  shareCode: string;
}>;


export type ProfileSharePreviewQuery = { profileSharePreview: { wouldLock: boolean, nameConflict: boolean } | null };

export type LookUpShareCodeMutationVariables = Exact<{
  input: LookUpShareCodeInput;
}>;


export type LookUpShareCodeMutation = { lookUpShareCode: { householdName: string | null, userErrors: Array<{ __typename: 'ShareCodeRefusedError', message: string }> } | null };

export type OfferProfileShareMutationVariables = Exact<{
  input: OfferProfileShareInput;
}>;


export type OfferProfileShareMutation = { offerProfileShare: { share: { id: string, status: ProfileShareStatus } | null, userErrors: Array<
      | { __typename: 'ProfileAlreadySharedError', message: string }
      | { __typename: 'ProfileNotFoundError', message: string }
      | { __typename: 'ShareCodeRefusedError', message: string }
    > } | null };

export type AcceptProfileShareMutationVariables = Exact<{
  input: AcceptProfileShareInput;
}>;


export type AcceptProfileShareMutation = { acceptProfileShare: { share: { id: string, status: ProfileShareStatus } | null, userErrors: Array<
      | { __typename: 'OfferInvalidatedError', message: string }
      | { __typename: 'RestrictedProfileRequiresHouseholdAdminError', message: string }
      | { __typename: 'ShareNameConflictError', message: string }
      | { __typename: 'ShareNotFoundError', message: string }
      | { __typename: 'ShareNotPendingError', message: string }
    > } | null };

export type RejectProfileShareMutationVariables = Exact<{
  input: RejectProfileShareInput;
}>;


export type RejectProfileShareMutation = { rejectProfileShare: { share: { id: string, status: ProfileShareStatus } | null, userErrors: Array<
      | { __typename: 'ShareNotFoundError', message: string }
      | { __typename: 'ShareNotPendingError', message: string }
    > } | null };

export type CancelProfileShareMutationVariables = Exact<{
  input: CancelProfileShareInput;
}>;


export type CancelProfileShareMutation = { cancelProfileShare: { share: { id: string, status: ProfileShareStatus } | null, userErrors: Array<
      | { __typename: 'ShareNotFoundError', message: string }
      | { __typename: 'ShareNotPendingError', message: string }
    > } | null };

export type EndProfileShareMutationVariables = Exact<{
  input: EndProfileShareInput;
}>;


export type EndProfileShareMutation = { endProfileShare: { share: { id: string, status: ProfileShareStatus } | null, userErrors: Array<
      | { __typename: 'MembershipShareCannotEndError', message: string }
      | { __typename: 'ShareNotActiveError', message: string }
      | { __typename: 'ShareNotFoundError', message: string }
    > } | null };

export type SharedProfileFieldsFragment = { id: string, name: string, picture: string | null, kind: ProfileKind, personalProfile: boolean, restricted: boolean };

export type ShareOfferFieldsFragment = { id: string, profileId: string, householdId: string, status: ProfileShareStatus, expiresAt: string | null, offeredByDisplayName: string | null, visitor: boolean | null, profile: { id: string, name: string, picture: string | null, kind: ProfileKind, personalProfile: boolean, restricted: boolean } | null };

export type ProfileShareFieldsFragment = { id: string, householdId: string, status: ProfileShareStatus, requiredByAccountMembership: boolean, expiresAt: string | null, endedAt: string | null, invalidationReason: string | null, household: { id: string, name: string } | null };

export type ProfileShareChangedSubscriptionVariables = Exact<{ [key: string]: never; }>;


export type ProfileShareChangedSubscription = { profileShareChanged: { shareId: string, share: { id: string, profileId: string, householdId: string, status: ProfileShareStatus, expiresAt: string | null, offeredByDisplayName: string | null, visitor: boolean | null, requiredByAccountMembership: boolean, endedAt: string | null, invalidationReason: string | null, profile: { id: string, name: string, picture: string | null, kind: ProfileKind, personalProfile: boolean, restricted: boolean } | null, household: { id: string, name: string } | null } | null } | null };

export type ReportStreamSessionTimelineMutationVariables = Exact<{
  sessionId: string | number;
  positionSeconds: number;
  state: PlaybackState;
}>;


export type ReportStreamSessionTimelineMutation = { reportStreamSessionTimeline: boolean };

export type HouseholdShareCodesQueryVariables = Exact<{
  householdId: string | number;
}>;


export type HouseholdShareCodesQuery = { householdShareCodes: { edges: Array<{ node: { id: string, householdId: string, status: ShareCodeStatus, issuedAt: string, expiresAt: string, issuedByDisplayName: string | null } }> } };

export type IssueShareCodeMutationVariables = Exact<{
  input: IssueShareCodeInput;
}>;


export type IssueShareCodeMutation = { issueShareCode: { issued: { code: string, shareCode: { id: string, householdId: string, status: ShareCodeStatus, issuedAt: string, expiresAt: string, issuedByDisplayName: string | null } } | null, userErrors: Array<{ __typename: 'HouseholdNotFoundError', message: string }> } | null };

export type WithdrawShareCodeMutationVariables = Exact<{
  input: WithdrawShareCodeInput;
}>;


export type WithdrawShareCodeMutation = { withdrawShareCode: { shareCode: { id: string, status: ShareCodeStatus } | null, userErrors: Array<
      | { __typename: 'ShareCodeNotFoundError', message: string }
      | { __typename: 'ShareCodeNotLiveError', message: string }
    > } | null };

export type ShareCodeFieldsFragment = { id: string, householdId: string, status: ShareCodeStatus, issuedAt: string, expiresAt: string, issuedByDisplayName: string | null };

export type HomeQueryVariables = Exact<{
  continueWatchingFirst: number;
}>;


export type HomeQuery = { continueWatching: { edges: Array<{ cursor: string, orderKey: string, node:
        | { __typename: 'Episode', id: string, title: string | null, episodeNumber: number, overview: string | null, runtime: number | null, images: Array<{ aspectRatio: number, blurHash: string | null, variants: Array<{ id: string, size: ImageSize, width: number, height: number, url: string } | null> } | null>, selectedProfileState: { watchState: { watchProgress: { positionSeconds: number, percentComplete: number, durationSeconds: number } | null } } | null, files: Array<{ id: string } | null>, season: { id: string, seasonNumber: number, series: { id: string, title: string | null, tagline: string | null, summary: string | null, createdOn: string, genres: Array<{ id: string, name: string } | null>, seasons: Array<{ id: string } | null>, images: Array<{ aspectRatio: number, blurHash: string | null, ambientColors: { topLeft: string, topRight: string, bottomRight: string, bottomLeft: string, primary: string, theme: { base: string, panel: string, selected: string, accent: string, onAccent: string, textPrimary: string, textSecondary: string } } | null, variants: Array<{ id: string, size: ImageSize, width: number, height: number, url: string } | null> } | null> } } }
        | { __typename: 'Movie', id: string, title: string | null, tagline: string | null, summary: string | null, runtime: number | null, createdOn: string, genres: Array<{ id: string, name: string } | null>, images: Array<{ aspectRatio: number, blurHash: string | null, ambientColors: { topLeft: string, topRight: string, bottomRight: string, bottomLeft: string, primary: string, theme: { base: string, panel: string, selected: string, accent: string, onAccent: string, textPrimary: string, textSecondary: string } } | null, variants: Array<{ id: string, size: ImageSize, width: number, height: number, url: string } | null> } | null>, selectedProfileState: { watchState: { watchProgress: { positionSeconds: number, percentComplete: number, durationSeconds: number } | null } } | null, files: Array<{ id: string } | null> }
       | null } | null> }, libraries: Array<{ id: string, name: string | null, type: MediaType, items: { edges: Array<{ cursor: string, node:
          | { __typename: 'Movie', tagline: string | null, summary: string | null, createdOn: string, id: string, title: string | null, titleSort: string | null, releaseDate: string | null, runtime: number | null, genres: Array<{ id: string, name: string } | null>, files: Array<{ id: string } | null>, backdropImages: Array<{ aspectRatio: number, blurHash: string | null, ambientColors: { topLeft: string, topRight: string, bottomRight: string, bottomLeft: string, primary: string, theme: { base: string, panel: string, selected: string, accent: string, onAccent: string, textPrimary: string, textSecondary: string } } | null, variants: Array<{ id: string, size: ImageSize, width: number, height: number, url: string } | null> } | null>, selectedProfileState: { watchState: { watchStatus: WatchStatus, lastWatchedAt: string | null, watchProgress: { percentComplete: number } | null } } | null, images: Array<{ aspectRatio: number, blurHash: string | null, variants: Array<{ id: string, size: ImageSize, width: number, height: number, url: string } | null> } | null> }
          | { __typename: 'Series', tagline: string | null, summary: string | null, createdOn: string, id: string, title: string | null, titleSort: string | null, firstAirDate: string | null, genres: Array<{ id: string, name: string } | null>, backdropImages: Array<{ aspectRatio: number, blurHash: string | null, ambientColors: { topLeft: string, topRight: string, bottomRight: string, bottomLeft: string, primary: string, theme: { base: string, panel: string, selected: string, accent: string, onAccent: string, textPrimary: string, textSecondary: string } } | null, variants: Array<{ id: string, size: ImageSize, width: number, height: number, url: string } | null> } | null>, seasons: Array<{ id: string } | null>, selectedProfileState: { watchState: { watchStatus: WatchStatus, lastWatchedAt: string | null, watchProgress: { percentComplete: number } | null } } | null, images: Array<{ aspectRatio: number, blurHash: string | null, variants: Array<{ id: string, size: ImageSize, width: number, height: number, url: string } | null> } | null> }
         | null } | null> | null } }> };

type ContinueWatchingItemFields_Episode_Fragment = { __typename: 'Episode', id: string, title: string | null, episodeNumber: number, overview: string | null, runtime: number | null, images: Array<{ aspectRatio: number, blurHash: string | null, variants: Array<{ id: string, size: ImageSize, width: number, height: number, url: string } | null> } | null>, selectedProfileState: { watchState: { watchProgress: { positionSeconds: number, percentComplete: number, durationSeconds: number } | null } } | null, files: Array<{ id: string } | null>, season: { id: string, seasonNumber: number, series: { id: string, title: string | null, tagline: string | null, summary: string | null, createdOn: string, genres: Array<{ id: string, name: string } | null>, seasons: Array<{ id: string } | null>, images: Array<{ aspectRatio: number, blurHash: string | null, ambientColors: { topLeft: string, topRight: string, bottomRight: string, bottomLeft: string, primary: string, theme: { base: string, panel: string, selected: string, accent: string, onAccent: string, textPrimary: string, textSecondary: string } } | null, variants: Array<{ id: string, size: ImageSize, width: number, height: number, url: string } | null> } | null> } } };

type ContinueWatchingItemFields_Movie_Fragment = { __typename: 'Movie', id: string, title: string | null, tagline: string | null, summary: string | null, runtime: number | null, createdOn: string, genres: Array<{ id: string, name: string } | null>, images: Array<{ aspectRatio: number, blurHash: string | null, ambientColors: { topLeft: string, topRight: string, bottomRight: string, bottomLeft: string, primary: string, theme: { base: string, panel: string, selected: string, accent: string, onAccent: string, textPrimary: string, textSecondary: string } } | null, variants: Array<{ id: string, size: ImageSize, width: number, height: number, url: string } | null> } | null>, selectedProfileState: { watchState: { watchProgress: { positionSeconds: number, percentComplete: number, durationSeconds: number } | null } } | null, files: Array<{ id: string } | null> };

export type ContinueWatchingItemFieldsFragment =
  | ContinueWatchingItemFields_Episode_Fragment
  | ContinueWatchingItemFields_Movie_Fragment
;

export type ContinueWatchingEdgeFieldsFragment = { cursor: string, orderKey: string, node:
    | { __typename: 'Episode', id: string, title: string | null, episodeNumber: number, overview: string | null, runtime: number | null, images: Array<{ aspectRatio: number, blurHash: string | null, variants: Array<{ id: string, size: ImageSize, width: number, height: number, url: string } | null> } | null>, selectedProfileState: { watchState: { watchProgress: { positionSeconds: number, percentComplete: number, durationSeconds: number } | null } } | null, files: Array<{ id: string } | null>, season: { id: string, seasonNumber: number, series: { id: string, title: string | null, tagline: string | null, summary: string | null, createdOn: string, genres: Array<{ id: string, name: string } | null>, seasons: Array<{ id: string } | null>, images: Array<{ aspectRatio: number, blurHash: string | null, ambientColors: { topLeft: string, topRight: string, bottomRight: string, bottomLeft: string, primary: string, theme: { base: string, panel: string, selected: string, accent: string, onAccent: string, textPrimary: string, textSecondary: string } } | null, variants: Array<{ id: string, size: ImageSize, width: number, height: number, url: string } | null> } | null> } } }
    | { __typename: 'Movie', id: string, title: string | null, tagline: string | null, summary: string | null, runtime: number | null, createdOn: string, genres: Array<{ id: string, name: string } | null>, images: Array<{ aspectRatio: number, blurHash: string | null, ambientColors: { topLeft: string, topRight: string, bottomRight: string, bottomLeft: string, primary: string, theme: { base: string, panel: string, selected: string, accent: string, onAccent: string, textPrimary: string, textSecondary: string } } | null, variants: Array<{ id: string, size: ImageSize, width: number, height: number, url: string } | null> } | null>, selectedProfileState: { watchState: { watchProgress: { positionSeconds: number, percentComplete: number, durationSeconds: number } | null } } | null, files: Array<{ id: string } | null> }
   | null };

export type ProfileLanguagePreferencesFieldsFragment = { __typename: 'ProfileLanguagePreferences', audioLanguages: Array<Language>, subtitleLanguage: Language | null, subtitleMode: SubtitleMode };

export type LanguageSettingsQueryVariables = Exact<{ [key: string]: never; }>;


export type LanguageSettingsQuery = { me: { __typename: 'Me', languagePreferences: { __typename: 'ProfileLanguagePreferences', audioLanguages: Array<Language>, subtitleLanguage: Language | null, subtitleMode: SubtitleMode } | null } };

export type SetLanguagePreferencesMutationVariables = Exact<{
  input: SetLanguagePreferencesInput;
}>;


export type SetLanguagePreferencesMutation = { setLanguagePreferences: { languagePreferences: { __typename: 'ProfileLanguagePreferences', audioLanguages: Array<Language>, subtitleLanguage: Language | null, subtitleMode: SubtitleMode } | null, userErrors: Array<
      | { __typename: 'RepeatedAudioLanguageError', message: string, inputPath: Array<string> }
      | { __typename: 'TooManyAudioLanguagesError', message: string, inputPath: Array<string> }
    > } | null };

export type LanguagePreferenceFieldsFragment = { __typename: 'LanguagePreference', audioLanguages: Array<Language>, subtitleLanguage: Language | null, subtitleMode: SubtitleMode, audioSource: PreferenceSource, subtitleSource: PreferenceSource };

export type LanguageTabsQueryVariables = Exact<{
  id: string | number;
  movie: boolean;
  series: boolean;
  season: boolean;
}>;


export type LanguageTabsQuery = { movie?: { __typename: 'Movie', id: string, selectedProfileState: { languagePreference: { __typename: 'LanguagePreference', audioLanguages: Array<Language>, subtitleLanguage: Language | null, subtitleMode: SubtitleMode, audioSource: PreferenceSource, subtitleSource: PreferenceSource } } | null } | null, series?: { __typename: 'Series', id: string, selectedProfileState: { languagePreference: { __typename: 'LanguagePreference', audioLanguages: Array<Language>, subtitleLanguage: Language | null, subtitleMode: SubtitleMode, audioSource: PreferenceSource, subtitleSource: PreferenceSource } } | null } | null, season?: { __typename: 'Season', id: string, selectedProfileState: { languagePreference: { __typename: 'LanguagePreference', audioLanguages: Array<Language>, subtitleLanguage: Language | null, subtitleMode: SubtitleMode, audioSource: PreferenceSource, subtitleSource: PreferenceSource } } | null, series: { __typename: 'Series', id: string, selectedProfileState: { languagePreference: { __typename: 'LanguagePreference', audioLanguages: Array<Language>, subtitleLanguage: Language | null, subtitleMode: SubtitleMode, audioSource: PreferenceSource, subtitleSource: PreferenceSource } } | null } } | null, me: { __typename: 'Me', languagePreferences: { __typename: 'ProfileLanguagePreferences', audioLanguages: Array<Language>, subtitleLanguage: Language | null, subtitleMode: SubtitleMode } | null } };

export type SetLanguageOverrideMutationVariables = Exact<{
  input: SetLanguageOverrideInput;
}>;


export type SetLanguageOverrideMutation = { setLanguageOverride: { item:
      | { __typename: 'Episode', id: string, selectedProfileState: { languagePreference: { __typename: 'LanguagePreference', audioLanguages: Array<Language>, subtitleLanguage: Language | null, subtitleMode: SubtitleMode, audioSource: PreferenceSource, subtitleSource: PreferenceSource } } | null }
      | { __typename: 'Movie', id: string, selectedProfileState: { languagePreference: { __typename: 'LanguagePreference', audioLanguages: Array<Language>, subtitleLanguage: Language | null, subtitleMode: SubtitleMode, audioSource: PreferenceSource, subtitleSource: PreferenceSource } } | null }
      | { __typename: 'Season', id: string, selectedProfileState: { languagePreference: { __typename: 'LanguagePreference', audioLanguages: Array<Language>, subtitleLanguage: Language | null, subtitleMode: SubtitleMode, audioSource: PreferenceSource, subtitleSource: PreferenceSource } } | null }
      | { __typename: 'Series', id: string, selectedProfileState: { languagePreference: { __typename: 'LanguagePreference', audioLanguages: Array<Language>, subtitleLanguage: Language | null, subtitleMode: SubtitleMode, audioSource: PreferenceSource, subtitleSource: PreferenceSource } } | null }
     | null, userErrors: Array<
      | { __typename: 'InvalidIdError', message: string }
      | { __typename: 'ItemNotFoundError', message: string }
    > } | null };

export type LibraryItemChangeFieldsFragment = { libraryId: string, itemId: string, kind: MediaType, item:
    | { __typename: 'Movie', id: string, title: string | null, titleSort: string | null, releaseDate: string | null, runtime: number | null, selectedProfileState: { watchState: { watchStatus: WatchStatus, lastWatchedAt: string | null, watchProgress: { percentComplete: number } | null } } | null, images: Array<{ aspectRatio: number, blurHash: string | null, variants: Array<{ id: string, size: ImageSize, width: number, height: number, url: string } | null> } | null> }
    | { __typename: 'Series', id: string, title: string | null, titleSort: string | null, firstAirDate: string | null, seasons: Array<{ id: string } | null>, selectedProfileState: { watchState: { watchStatus: WatchStatus, lastWatchedAt: string | null, watchProgress: { percentComplete: number } | null } } | null, images: Array<{ aspectRatio: number, blurHash: string | null, variants: Array<{ id: string, size: ImageSize, width: number, height: number, url: string } | null> } | null> }
   | null, edge: { cursor: string, orderKey: string, node:
      | { __typename: 'Movie', id: string, title: string | null, titleSort: string | null, releaseDate: string | null, runtime: number | null, selectedProfileState: { watchState: { watchStatus: WatchStatus, lastWatchedAt: string | null, watchProgress: { percentComplete: number } | null } } | null, images: Array<{ aspectRatio: number, blurHash: string | null, variants: Array<{ id: string, size: ImageSize, width: number, height: number, url: string } | null> } | null> }
      | { __typename: 'Series', id: string, title: string | null, titleSort: string | null, firstAirDate: string | null, seasons: Array<{ id: string } | null>, selectedProfileState: { watchState: { watchStatus: WatchStatus, lastWatchedAt: string | null, watchProgress: { percentComplete: number } | null } } | null, images: Array<{ aspectRatio: number, blurHash: string | null, variants: Array<{ id: string, size: ImageSize, width: number, height: number, url: string } | null> } | null> }
     | null } | null };

export type LibraryItemAddedSubscriptionVariables = Exact<{
  libraryId: string | number;
  sort?: MediaSort | null | undefined;
  filter?: MediaFilter | null | undefined;
}>;


export type LibraryItemAddedSubscription = { change: { libraryId: string, itemId: string, kind: MediaType, item:
      | { __typename: 'Movie', id: string, title: string | null, titleSort: string | null, releaseDate: string | null, runtime: number | null, selectedProfileState: { watchState: { watchStatus: WatchStatus, lastWatchedAt: string | null, watchProgress: { percentComplete: number } | null } } | null, images: Array<{ aspectRatio: number, blurHash: string | null, variants: Array<{ id: string, size: ImageSize, width: number, height: number, url: string } | null> } | null> }
      | { __typename: 'Series', id: string, title: string | null, titleSort: string | null, firstAirDate: string | null, seasons: Array<{ id: string } | null>, selectedProfileState: { watchState: { watchStatus: WatchStatus, lastWatchedAt: string | null, watchProgress: { percentComplete: number } | null } } | null, images: Array<{ aspectRatio: number, blurHash: string | null, variants: Array<{ id: string, size: ImageSize, width: number, height: number, url: string } | null> } | null> }
     | null, edge: { cursor: string, orderKey: string, node:
        | { __typename: 'Movie', id: string, title: string | null, titleSort: string | null, releaseDate: string | null, runtime: number | null, selectedProfileState: { watchState: { watchStatus: WatchStatus, lastWatchedAt: string | null, watchProgress: { percentComplete: number } | null } } | null, images: Array<{ aspectRatio: number, blurHash: string | null, variants: Array<{ id: string, size: ImageSize, width: number, height: number, url: string } | null> } | null> }
        | { __typename: 'Series', id: string, title: string | null, titleSort: string | null, firstAirDate: string | null, seasons: Array<{ id: string } | null>, selectedProfileState: { watchState: { watchStatus: WatchStatus, lastWatchedAt: string | null, watchProgress: { percentComplete: number } | null } } | null, images: Array<{ aspectRatio: number, blurHash: string | null, variants: Array<{ id: string, size: ImageSize, width: number, height: number, url: string } | null> } | null> }
       | null } | null } | null };

export type LibraryItemUpdatedSubscriptionVariables = Exact<{
  libraryId: string | number;
  sort?: MediaSort | null | undefined;
  filter?: MediaFilter | null | undefined;
}>;


export type LibraryItemUpdatedSubscription = { change: { libraryId: string, itemId: string, kind: MediaType, item:
      | { __typename: 'Movie', id: string, title: string | null, titleSort: string | null, releaseDate: string | null, runtime: number | null, selectedProfileState: { watchState: { watchStatus: WatchStatus, lastWatchedAt: string | null, watchProgress: { percentComplete: number } | null } } | null, images: Array<{ aspectRatio: number, blurHash: string | null, variants: Array<{ id: string, size: ImageSize, width: number, height: number, url: string } | null> } | null> }
      | { __typename: 'Series', id: string, title: string | null, titleSort: string | null, firstAirDate: string | null, seasons: Array<{ id: string } | null>, selectedProfileState: { watchState: { watchStatus: WatchStatus, lastWatchedAt: string | null, watchProgress: { percentComplete: number } | null } } | null, images: Array<{ aspectRatio: number, blurHash: string | null, variants: Array<{ id: string, size: ImageSize, width: number, height: number, url: string } | null> } | null> }
     | null, edge: { cursor: string, orderKey: string, node:
        | { __typename: 'Movie', id: string, title: string | null, titleSort: string | null, releaseDate: string | null, runtime: number | null, selectedProfileState: { watchState: { watchStatus: WatchStatus, lastWatchedAt: string | null, watchProgress: { percentComplete: number } | null } } | null, images: Array<{ aspectRatio: number, blurHash: string | null, variants: Array<{ id: string, size: ImageSize, width: number, height: number, url: string } | null> } | null> }
        | { __typename: 'Series', id: string, title: string | null, titleSort: string | null, firstAirDate: string | null, seasons: Array<{ id: string } | null>, selectedProfileState: { watchState: { watchStatus: WatchStatus, lastWatchedAt: string | null, watchProgress: { percentComplete: number } | null } } | null, images: Array<{ aspectRatio: number, blurHash: string | null, variants: Array<{ id: string, size: ImageSize, width: number, height: number, url: string } | null> } | null> }
       | null } | null } | null };

export type LibraryItemRemovedSubscriptionVariables = Exact<{
  libraryId: string | number;
}>;


export type LibraryItemRemovedSubscription = { change: { libraryId: string, itemId: string, kind: MediaType } | null };

export type LibraryCountsChangedSubscriptionVariables = Exact<{
  libraryId: string | number;
}>;


export type LibraryCountsChangedSubscription = { change: { id: string, itemCount: number, alphabetIndex: Array<{ letter: AlphabetLetter, count: number }> } | null };

export type LibraryPageQueryVariables = Exact<{
  libraryId: string | number;
  first?: number | null | undefined;
  after?: string | null | undefined;
  last?: number | null | undefined;
  before?: string | null | undefined;
  sort?: MediaSort | null | undefined;
  filter?: MediaFilter | null | undefined;
}>;


export type LibraryPageQuery = { library: { id: string, name: string | null, itemCount: number, alphabetIndex: Array<{ letter: AlphabetLetter, count: number }>, items: { edges: Array<{ cursor: string, orderKey: string, node:
          | { __typename: 'Movie', id: string, title: string | null, titleSort: string | null, releaseDate: string | null, runtime: number | null, selectedProfileState: { watchState: { watchStatus: WatchStatus, lastWatchedAt: string | null, watchProgress: { percentComplete: number } | null } } | null, images: Array<{ aspectRatio: number, blurHash: string | null, variants: Array<{ id: string, size: ImageSize, width: number, height: number, url: string } | null> } | null> }
          | { __typename: 'Series', id: string, title: string | null, titleSort: string | null, firstAirDate: string | null, seasons: Array<{ id: string } | null>, selectedProfileState: { watchState: { watchStatus: WatchStatus, lastWatchedAt: string | null, watchProgress: { percentComplete: number } | null } } | null, images: Array<{ aspectRatio: number, blurHash: string | null, variants: Array<{ id: string, size: ImageSize, width: number, height: number, url: string } | null> } | null> }
         | null } | null> | null, pageInfo: { hasNextPage: boolean, hasPreviousPage: boolean, startCursor: string | null, endCursor: string | null } } } };

export type ImageWithAmbientFieldsFragment = { aspectRatio: number, blurHash: string | null, ambientColors: { topLeft: string, topRight: string, bottomRight: string, bottomLeft: string, primary: string, theme: { base: string, panel: string, selected: string, accent: string, onAccent: string, textPrimary: string, textSecondary: string } } | null, variants: Array<{ id: string, size: ImageSize, width: number, height: number, url: string } | null> };

export type MarkUnwatchedMutationVariables = Exact<{
  input: MarkUnwatchedInput;
}>;


export type MarkUnwatchedMutation = { markUnwatched: { item:
      | { __typename: 'Episode', id: string, season: { id: string, series: { id: string, selectedProfileState: { watchState: { watchStatus: WatchStatus, watchProgress: { positionSeconds: number, percentComplete: number, durationSeconds: number } | null } } | null }, selectedProfileState: { watchState: { watchStatus: WatchStatus, watchProgress: { positionSeconds: number, percentComplete: number, durationSeconds: number } | null } } | null }, selectedProfileState: { watchState: { watchStatus: WatchStatus, watchProgress: { positionSeconds: number, percentComplete: number, durationSeconds: number } | null } } | null }
      | { __typename: 'Movie', id: string, selectedProfileState: { watchState: { watchStatus: WatchStatus, watchProgress: { positionSeconds: number, percentComplete: number, durationSeconds: number } | null } } | null }
      | { __typename: 'Season', id: string, episodes: Array<{ id: string, selectedProfileState: { watchState: { watchStatus: WatchStatus, watchProgress: { positionSeconds: number, percentComplete: number, durationSeconds: number } | null } } | null } | null>, series: { id: string, selectedProfileState: { watchState: { watchStatus: WatchStatus, watchProgress: { positionSeconds: number, percentComplete: number, durationSeconds: number } | null } } | null }, selectedProfileState: { watchState: { watchStatus: WatchStatus, watchProgress: { positionSeconds: number, percentComplete: number, durationSeconds: number } | null } } | null }
      | { __typename: 'Series', id: string, seasons: Array<{ id: string, episodes: Array<{ id: string, selectedProfileState: { watchState: { watchStatus: WatchStatus, watchProgress: { positionSeconds: number, percentComplete: number, durationSeconds: number } | null } } | null } | null>, selectedProfileState: { watchState: { watchStatus: WatchStatus, watchProgress: { positionSeconds: number, percentComplete: number, durationSeconds: number } | null } } | null } | null>, selectedProfileState: { watchState: { watchStatus: WatchStatus, watchProgress: { positionSeconds: number, percentComplete: number, durationSeconds: number } | null } } | null }
     | null, userErrors: Array<
      | { __typename: 'InvalidIdError', message: string }
      | { __typename: 'ItemNotFoundError', message: string }
    > } | null };

export type MarkWatchedMutationVariables = Exact<{
  input: MarkWatchedInput;
}>;


export type MarkWatchedMutation = { markWatched: { item:
      | { __typename: 'Episode', id: string, season: { id: string, series: { id: string, selectedProfileState: { watchState: { watchStatus: WatchStatus, watchProgress: { positionSeconds: number, percentComplete: number, durationSeconds: number } | null } } | null }, selectedProfileState: { watchState: { watchStatus: WatchStatus, watchProgress: { positionSeconds: number, percentComplete: number, durationSeconds: number } | null } } | null }, selectedProfileState: { watchState: { watchStatus: WatchStatus, watchProgress: { positionSeconds: number, percentComplete: number, durationSeconds: number } | null } } | null }
      | { __typename: 'Movie', id: string, selectedProfileState: { watchState: { watchStatus: WatchStatus, watchProgress: { positionSeconds: number, percentComplete: number, durationSeconds: number } | null } } | null }
      | { __typename: 'Season', id: string, episodes: Array<{ id: string, selectedProfileState: { watchState: { watchStatus: WatchStatus, watchProgress: { positionSeconds: number, percentComplete: number, durationSeconds: number } | null } } | null } | null>, series: { id: string, selectedProfileState: { watchState: { watchStatus: WatchStatus, watchProgress: { positionSeconds: number, percentComplete: number, durationSeconds: number } | null } } | null }, selectedProfileState: { watchState: { watchStatus: WatchStatus, watchProgress: { positionSeconds: number, percentComplete: number, durationSeconds: number } | null } } | null }
      | { __typename: 'Series', id: string, seasons: Array<{ id: string, episodes: Array<{ id: string, selectedProfileState: { watchState: { watchStatus: WatchStatus, watchProgress: { positionSeconds: number, percentComplete: number, durationSeconds: number } | null } } | null } | null>, selectedProfileState: { watchState: { watchStatus: WatchStatus, watchProgress: { positionSeconds: number, percentComplete: number, durationSeconds: number } | null } } | null } | null>, selectedProfileState: { watchState: { watchStatus: WatchStatus, watchProgress: { positionSeconds: number, percentComplete: number, durationSeconds: number } | null } } | null }
     | null, userErrors: Array<
      | { __typename: 'InvalidIdError', message: string }
      | { __typename: 'ItemNotFoundError', message: string }
    > } | null };

type MediaSummaryFields_Movie_Fragment = { __typename: 'Movie', id: string, title: string | null, titleSort: string | null, releaseDate: string | null, runtime: number | null, selectedProfileState: { watchState: { watchStatus: WatchStatus, lastWatchedAt: string | null, watchProgress: { percentComplete: number } | null } } | null, images: Array<{ aspectRatio: number, blurHash: string | null, variants: Array<{ id: string, size: ImageSize, width: number, height: number, url: string } | null> } | null> };

type MediaSummaryFields_Series_Fragment = { __typename: 'Series', id: string, title: string | null, titleSort: string | null, firstAirDate: string | null, seasons: Array<{ id: string } | null>, selectedProfileState: { watchState: { watchStatus: WatchStatus, lastWatchedAt: string | null, watchProgress: { percentComplete: number } | null } } | null, images: Array<{ aspectRatio: number, blurHash: string | null, variants: Array<{ id: string, size: ImageSize, width: number, height: number, url: string } | null> } | null> };

export type MediaSummaryFieldsFragment =
  | MediaSummaryFields_Movie_Fragment
  | MediaSummaryFields_Series_Fragment
;

type OrderedEdgeFields_ContinueWatchingEdge_Fragment = { cursor: string, orderKey: string };

type OrderedEdgeFields_MediaEdge_Fragment = { cursor: string, orderKey: string };

type OrderedEdgeFields_NotificationEdge_Fragment = { cursor: string, orderKey: string };

export type OrderedEdgeFieldsFragment =
  | OrderedEdgeFields_ContinueWatchingEdge_Fragment
  | OrderedEdgeFields_MediaEdge_Fragment
  | OrderedEdgeFields_NotificationEdge_Fragment
;

export type WatchStateChangedSubscriptionVariables = Exact<{ [key: string]: never; }>;


export type WatchStateChangedSubscription = { watchStateChanged: { continueWatching: Array<{ itemId: string, edge: { cursor: string, orderKey: string, node:
          | { __typename: 'Episode', id: string, title: string | null, episodeNumber: number, overview: string | null, runtime: number | null, images: Array<{ aspectRatio: number, blurHash: string | null, variants: Array<{ id: string, size: ImageSize, width: number, height: number, url: string } | null> } | null>, selectedProfileState: { watchState: { watchProgress: { positionSeconds: number, percentComplete: number, durationSeconds: number } | null } } | null, files: Array<{ id: string } | null>, season: { id: string, seasonNumber: number, series: { id: string, title: string | null, tagline: string | null, summary: string | null, createdOn: string, genres: Array<{ id: string, name: string } | null>, seasons: Array<{ id: string } | null>, images: Array<{ aspectRatio: number, blurHash: string | null, ambientColors: { topLeft: string, topRight: string, bottomRight: string, bottomLeft: string, primary: string, theme: { base: string, panel: string, selected: string, accent: string, onAccent: string, textPrimary: string, textSecondary: string } } | null, variants: Array<{ id: string, size: ImageSize, width: number, height: number, url: string } | null> } | null> } } }
          | { __typename: 'Movie', id: string, title: string | null, tagline: string | null, summary: string | null, runtime: number | null, createdOn: string, genres: Array<{ id: string, name: string } | null>, images: Array<{ aspectRatio: number, blurHash: string | null, ambientColors: { topLeft: string, topRight: string, bottomRight: string, bottomLeft: string, primary: string, theme: { base: string, panel: string, selected: string, accent: string, onAccent: string, textPrimary: string, textSecondary: string } } | null, variants: Array<{ id: string, size: ImageSize, width: number, height: number, url: string } | null> } | null>, selectedProfileState: { watchState: { watchProgress: { positionSeconds: number, percentComplete: number, durationSeconds: number } | null } } | null, files: Array<{ id: string } | null> }
         | null } | null } | null> | null, items: Array<
      | { __typename: 'Episode', id: string, selectedProfileState: { watchState: { watchStatus: WatchStatus, watchProgress: { positionSeconds: number, percentComplete: number, durationSeconds: number } | null } } | null }
      | { __typename: 'Movie', unmatched: boolean, id: string, selectedProfileState: { watchState: { lastWatchedAt: string | null, watchStatus: WatchStatus, watchProgress: { positionSeconds: number, percentComplete: number, durationSeconds: number } | null } } | null, library: { id: string } }
      | { __typename: 'Season', id: string, selectedProfileState: { watchState: { watchStatus: WatchStatus, watchProgress: { positionSeconds: number, percentComplete: number, durationSeconds: number } | null } } | null }
      | { __typename: 'Series', unmatched: boolean, id: string, selectedProfileState: { watchState: { lastWatchedAt: string | null, watchStatus: WatchStatus, watchProgress: { positionSeconds: number, percentComplete: number, durationSeconds: number } | null } } | null, library: { id: string } }
     | null> } | null };

type WatchStateItemFields_Episode_Fragment = { __typename: 'Episode', id: string, season: { id: string, series: { id: string, selectedProfileState: { watchState: { watchStatus: WatchStatus, watchProgress: { positionSeconds: number, percentComplete: number, durationSeconds: number } | null } } | null }, selectedProfileState: { watchState: { watchStatus: WatchStatus, watchProgress: { positionSeconds: number, percentComplete: number, durationSeconds: number } | null } } | null }, selectedProfileState: { watchState: { watchStatus: WatchStatus, watchProgress: { positionSeconds: number, percentComplete: number, durationSeconds: number } | null } } | null };

type WatchStateItemFields_Movie_Fragment = { __typename: 'Movie', id: string, selectedProfileState: { watchState: { watchStatus: WatchStatus, watchProgress: { positionSeconds: number, percentComplete: number, durationSeconds: number } | null } } | null };

type WatchStateItemFields_Season_Fragment = { __typename: 'Season', id: string, episodes: Array<{ id: string, selectedProfileState: { watchState: { watchStatus: WatchStatus, watchProgress: { positionSeconds: number, percentComplete: number, durationSeconds: number } | null } } | null } | null>, series: { id: string, selectedProfileState: { watchState: { watchStatus: WatchStatus, watchProgress: { positionSeconds: number, percentComplete: number, durationSeconds: number } | null } } | null }, selectedProfileState: { watchState: { watchStatus: WatchStatus, watchProgress: { positionSeconds: number, percentComplete: number, durationSeconds: number } | null } } | null };

type WatchStateItemFields_Series_Fragment = { __typename: 'Series', id: string, seasons: Array<{ id: string, episodes: Array<{ id: string, selectedProfileState: { watchState: { watchStatus: WatchStatus, watchProgress: { positionSeconds: number, percentComplete: number, durationSeconds: number } | null } } | null } | null>, selectedProfileState: { watchState: { watchStatus: WatchStatus, watchProgress: { positionSeconds: number, percentComplete: number, durationSeconds: number } | null } } | null } | null>, selectedProfileState: { watchState: { watchStatus: WatchStatus, watchProgress: { positionSeconds: number, percentComplete: number, durationSeconds: number } | null } } | null };

export type WatchStateItemFieldsFragment =
  | WatchStateItemFields_Episode_Fragment
  | WatchStateItemFields_Movie_Fragment
  | WatchStateItemFields_Season_Fragment
  | WatchStateItemFields_Series_Fragment
;

export type MovieWatchStateFragment = { id: string, selectedProfileState: { watchState: { watchStatus: WatchStatus, watchProgress: { positionSeconds: number, percentComplete: number, durationSeconds: number } | null } } | null };

export type EpisodeWatchStateFragment = { id: string, selectedProfileState: { watchState: { watchStatus: WatchStatus, watchProgress: { positionSeconds: number, percentComplete: number, durationSeconds: number } | null } } | null };

export type SeasonWatchStateFragment = { id: string, selectedProfileState: { watchState: { watchStatus: WatchStatus, watchProgress: { positionSeconds: number, percentComplete: number, durationSeconds: number } | null } } | null };

export type SeriesWatchStateFragment = { id: string, selectedProfileState: { watchState: { watchStatus: WatchStatus, watchProgress: { positionSeconds: number, percentComplete: number, durationSeconds: number } | null } } | null };

export type WatchStateFieldsFragment = { watchStatus: WatchStatus, watchProgress: { positionSeconds: number, percentComplete: number, durationSeconds: number } | null };

export type WatchProgressFieldsFragment = { positionSeconds: number, percentComplete: number, durationSeconds: number };

export type MovieDetailQueryVariables = Exact<{
  id: string | number;
}>;


export type MovieDetailQuery = { movie: { id: string, title: string | null, tagline: string | null, summary: string | null, runtime: number | null, releaseDate: string | null, contentRating: { value: string } | null, genres: Array<{ id: string, name: string } | null>, directors: Array<{ id: string, name: string } | null>, cast: Array<{ id: string, name: string, images: Array<{ aspectRatio: number, blurHash: string | null, variants: Array<{ id: string, size: ImageSize, width: number, height: number, url: string } | null> } | null> } | null>, ratings: Array<{ id: string, source: string, value: string } | null>, files: Array<{ id: string } | null>, selectedProfileState: { watchState: { watchStatus: WatchStatus, watchProgress: { positionSeconds: number, percentComplete: number, durationSeconds: number } | null } } | null, backdropImages: Array<{ aspectRatio: number, blurHash: string | null, ambientColors: { topLeft: string, topRight: string, bottomRight: string, bottomLeft: string, primary: string, theme: { base: string, panel: string, selected: string, accent: string, onAccent: string, textPrimary: string, textSecondary: string } } | null, variants: Array<{ id: string, size: ImageSize, width: number, height: number, url: string } | null> } | null>, posterImages: Array<{ aspectRatio: number, blurHash: string | null, ambientColors: { topLeft: string, topRight: string, bottomRight: string, bottomLeft: string, primary: string, theme: { base: string, panel: string, selected: string, accent: string, onAccent: string, textPrimary: string, textSecondary: string } } | null, variants: Array<{ id: string, size: ImageSize, width: number, height: number, url: string } | null> } | null> } | null };

type NotificationFields_ProfileShareAnsweredNotification_Fragment = { __typename: 'ProfileShareAnsweredNotification', id: string, message: string, latestEventAt: string, unread: boolean };

type NotificationFields_ProfileShareEndedNotification_Fragment = { __typename: 'ProfileShareEndedNotification', id: string, message: string, latestEventAt: string, unread: boolean };

type NotificationFields_ProfileShareOfferedNotification_Fragment = { __typename: 'ProfileShareOfferedNotification', expiresAt: string | null, resolution: RequestResolution | null, answer: ProfileShareAnswer | null, id: string, message: string, latestEventAt: string, unread: boolean };

export type NotificationFieldsFragment =
  | NotificationFields_ProfileShareAnsweredNotification_Fragment
  | NotificationFields_ProfileShareEndedNotification_Fragment
  | NotificationFields_ProfileShareOfferedNotification_Fragment
;

export type NotificationEdgeFieldsFragment = { cursor: string, orderKey: string, node:
    | { __typename: 'ProfileShareAnsweredNotification', id: string, message: string, latestEventAt: string, unread: boolean }
    | { __typename: 'ProfileShareEndedNotification', id: string, message: string, latestEventAt: string, unread: boolean }
    | { __typename: 'ProfileShareOfferedNotification', expiresAt: string | null, resolution: RequestResolution | null, answer: ProfileShareAnswer | null, id: string, message: string, latestEventAt: string, unread: boolean }
   | null };

export type NotificationsQueryVariables = Exact<{
  first?: number | null | undefined;
  after?: string | null | undefined;
}>;


export type NotificationsQuery = { notifications: { edges: Array<{ cursor: string, orderKey: string, node:
        | { __typename: 'ProfileShareAnsweredNotification', id: string, message: string, latestEventAt: string, unread: boolean }
        | { __typename: 'ProfileShareEndedNotification', id: string, message: string, latestEventAt: string, unread: boolean }
        | { __typename: 'ProfileShareOfferedNotification', expiresAt: string | null, resolution: RequestResolution | null, answer: ProfileShareAnswer | null, id: string, message: string, latestEventAt: string, unread: boolean }
       | null } | null>, pageInfo: { hasNextPage: boolean, endCursor: string | null } } };

export type MarkNotificationsReadMutationVariables = Exact<{
  input: MarkNotificationsReadInput;
}>;


export type MarkNotificationsReadMutation = { markNotificationsRead: { unreadNotificationCount: number | null, userErrors: Array<
      | { __typename: 'InvalidIdError', message: string }
      | { __typename: 'NotificationIdCountOutOfRangeError', message: string }
    > } | null };

export type NotificationsChangedSubscriptionVariables = Exact<{ [key: string]: never; }>;


export type NotificationsChangedSubscription = { notificationsChanged: { unreadNotificationCount: number | null, notifications: Array<{ notificationId: string, edge: { cursor: string, orderKey: string, node:
          | { __typename: 'ProfileShareAnsweredNotification', id: string, message: string, latestEventAt: string, unread: boolean }
          | { __typename: 'ProfileShareEndedNotification', id: string, message: string, latestEventAt: string, unread: boolean }
          | { __typename: 'ProfileShareOfferedNotification', expiresAt: string | null, resolution: RequestResolution | null, answer: ProfileShareAnswer | null, id: string, message: string, latestEventAt: string, unread: boolean }
         | null } | null } | null> } | null };

export type UnreadNotificationCountQueryVariables = Exact<{ [key: string]: never; }>;


export type UnreadNotificationCountQuery = { unreadNotificationCount: number };

export type SeasonDetailQueryVariables = Exact<{
  id: string | number;
}>;


export type SeasonDetailQuery = { season: { id: string, title: string | null, seasonNumber: number, overview: string | null, airDate: string | null, selectedProfileState: { watchState: { watchStatus: WatchStatus } } | null, series: { id: string, title: string | null, contentRating: { value: string } | null, directors: Array<{ id: string, name: string } | null>, seasons: Array<{ id: string, seasonNumber: number, title: string | null, selectedProfileState: { watchState: { watchStatus: WatchStatus } } | null, episodes: Array<{ id: string, selectedProfileState: { watchState: { watchStatus: WatchStatus } } | null } | null> } | null>, backdropImages: Array<{ aspectRatio: number, blurHash: string | null, ambientColors: { topLeft: string, topRight: string, bottomRight: string, bottomLeft: string, primary: string, theme: { base: string, panel: string, selected: string, accent: string, onAccent: string, textPrimary: string, textSecondary: string } } | null, variants: Array<{ id: string, size: ImageSize, width: number, height: number, url: string } | null> } | null> }, episodes: Array<{ id: string, title: string | null, episodeNumber: number, runtime: number | null, selectedProfileState: { watchState: { watchStatus: WatchStatus, watchProgress: { positionSeconds: number, percentComplete: number, durationSeconds: number } | null } } | null, files: Array<{ id: string } | null>, stillImages: Array<{ aspectRatio: number, blurHash: string | null, variants: Array<{ id: string, size: ImageSize, width: number, height: number, url: string } | null> } | null> } | null>, backdropImages: Array<{ aspectRatio: number, blurHash: string | null, ambientColors: { topLeft: string, topRight: string, bottomRight: string, bottomLeft: string, primary: string, theme: { base: string, panel: string, selected: string, accent: string, onAccent: string, textPrimary: string, textSecondary: string } } | null, variants: Array<{ id: string, size: ImageSize, width: number, height: number, url: string } | null> } | null>, posterImages: Array<{ aspectRatio: number, blurHash: string | null, ambientColors: { topLeft: string, topRight: string, bottomRight: string, bottomLeft: string, primary: string, theme: { base: string, panel: string, selected: string, accent: string, onAccent: string, textPrimary: string, textSecondary: string } } | null, variants: Array<{ id: string, size: ImageSize, width: number, height: number, url: string } | null> } | null> } | null };

export type SeriesDetailQueryVariables = Exact<{
  id: string | number;
}>;


export type SeriesDetailQuery = { series: { id: string, title: string | null, tagline: string | null, summary: string | null, firstAirDate: string | null, contentRating: { value: string } | null, genres: Array<{ id: string, name: string } | null>, directors: Array<{ id: string, name: string } | null>, cast: Array<{ id: string, name: string, images: Array<{ aspectRatio: number, blurHash: string | null, variants: Array<{ id: string, size: ImageSize, width: number, height: number, url: string } | null> } | null> } | null>, selectedProfileState: { watchState: { watchStatus: WatchStatus } } | null, seasons: Array<{ id: string, seasonNumber: number, title: string | null, airDate: string | null, selectedProfileState: { watchState: { watchStatus: WatchStatus, watchProgress: { percentComplete: number } | null } } | null, posterImages: Array<{ aspectRatio: number, blurHash: string | null, variants: Array<{ id: string, size: ImageSize, width: number, height: number, url: string } | null> } | null>, episodes: Array<{ id: string, episodeNumber: number, selectedProfileState: { watchState: { watchStatus: WatchStatus, watchProgress: { positionSeconds: number, durationSeconds: number } | null } } | null, files: Array<{ id: string } | null> } | null> } | null>, backdropImages: Array<{ aspectRatio: number, blurHash: string | null, ambientColors: { topLeft: string, topRight: string, bottomRight: string, bottomLeft: string, primary: string, theme: { base: string, panel: string, selected: string, accent: string, onAccent: string, textPrimary: string, textSecondary: string } } | null, variants: Array<{ id: string, size: ImageSize, width: number, height: number, url: string } | null> } | null>, posterImages: Array<{ aspectRatio: number, blurHash: string | null, ambientColors: { topLeft: string, topRight: string, bottomRight: string, bottomLeft: string, primary: string, theme: { base: string, panel: string, selected: string, accent: string, onAccent: string, textPrimary: string, textSecondary: string } } | null, variants: Array<{ id: string, size: ImageSize, width: number, height: number, url: string } | null> } | null> } | null };

export type CreatePlaybackSessionMutationVariables = Exact<{
  input: CreatePlaybackSessionInput;
}>;


export type CreatePlaybackSessionMutation = { createPlaybackSession: { playbackSession: { id: string, formatAttemptCount: number, maximumFormatAttempts: number, requestedChoice: VideoQuality, playbackChoice: VideoQuality, formatChange: PlaybackFormatChange | null, offeredChoices: Array<VideoQuality>, currentFormatAttempt:
        | { __typename: 'FailedPlaybackFormatAttempt', streamSessionId: string, error:
            | { __typename: 'InvalidMediaFileError', message: string }
            | { __typename: 'MediaFileFrameRateUnknownError', message: string }
            | { __typename: 'MediaFileHasNoVideoError', message: string }
            | { __typename: 'MediaFileNotFoundError', message: string }
            | { __typename: 'MediaFileProbeNotReadyError', message: string }
            | { __typename: 'NoEligibleVideoFormatError', message: string }
            | { __typename: 'PlaybackFormatAttemptsExhaustedError', message: string }
            | { __typename: 'PlaybackFormatRejectedError', message: string }
            | { __typename: 'PlaybackInvalidSpecificationError', message: string }
            | { __typename: 'PlaybackOutputMismatchError', message: string }
            | { __typename: 'PlaybackStartupFailedError', message: string }
            | { __typename: 'StartPositionOutOfRangeError', message: string }
            | { __typename: 'TranscodeCapacityUnavailableError', message: string }
           }
        | { __typename: 'PendingPlaybackFormatAttempt', streamSessionId: string }
        | { __typename: 'ReadyPlaybackFormatAttempt', streamSession:
            | { __typename: 'DirectPlayStreamSession', sourceContainer: SourceContainer, videoRange: VideoRange, startPositionSeconds: number | null, audioTrackPosition: number | null, id: string, streamUrl: string, audioTracks: Array<{ position: number, language: string | null, title: string | null }> }
            | { __typename: 'HlsStreamSession', transcodeMode: TranscodeMode, videoRange: VideoRange, mediaEndSeconds: number | null, id: string, streamUrl: string }
           }
       } | null, userErrors: Array<
      | { __typename: 'AudioMinBlockSizeInvalidError', message: string }
      | { __typename: 'CapabilityListTooLongError', message: string }
      | { __typename: 'CapabilityMaximumInvalidError', message: string }
      | { __typename: 'CapabilityProfileMismatchError', message: string }
      | { __typename: 'CapabilityValuesRequiredError', message: string }
      | { __typename: 'HlsAacCapabilityRequiredError', message: string }
      | { __typename: 'InvalidIdError', message: string }
      | { __typename: 'InvalidMediaFileError', message: string }
      | { __typename: 'MediaFileFrameRateUnknownError', message: string }
      | { __typename: 'MediaFileHasNoVideoError', message: string }
      | { __typename: 'MediaFileNotFoundError', message: string }
      | { __typename: 'MediaFileProbeNotReadyError', message: string }
      | { __typename: 'NoEligibleVideoFormatError', message: string }
      | { __typename: 'PlaybackSessionClosedError', message: string }
      | { __typename: 'StartPositionOutOfRangeError', message: string }
      | { __typename: 'TranscodeCapacityUnavailableError', message: string }
      | { __typename: 'VideoCodecTierInvalidError', message: string }
    > } | null };

export type DestroyPlaybackSessionMutationVariables = Exact<{
  input: DestroyPlaybackSessionInput;
}>;


export type DestroyPlaybackSessionMutation = { destroyPlaybackSession: { playbackSessionId: string | null, userErrors: Array<{ __typename: 'InvalidIdError', message: string }> } | null };

export type PlaybackDecisionFieldsFragment = { formatAttempt: number, streamSessionId: string, reasons: Array<DecisionReason>, video: { delivery: PlaybackDelivery, source: { codec: string, width: number, height: number, frameRate: number | null, bitrate: number | null, videoRange: VideoRange, dolbyVision: boolean, details: { codecProfile: VideoCodecProfile | null, codecLevel: number | null, bitDepth: number | null, chromaSubsampling: ChromaSubsampling | null, compatibleBase: CompatibleBase, hdr10Plus: MetadataPresence, bitstreamRewrites: Array<BitstreamRewrite>, dolbyVision: { presence: MetadataPresence, profile: number | null, level: number | null, baseLayerCompatibilityId: number | null, enhancementLayer: DolbyVisionEnhancementLayer | null, observedRpu: MetadataPresence | null }, masteringDisplay: { minLuminance: number, maxLuminance: number } | null, contentLightLevel: { maxContentLightLevel: number, maxFrameAverageLightLevel: number } | null } | null }, output: { codec: string, width: number, height: number, frameRate: number | null, bitrate: number | null, videoRange: VideoRange, dolbyVision: boolean, details: { codecProfile: VideoCodecProfile | null, codecLevel: number | null, bitDepth: number | null, chromaSubsampling: ChromaSubsampling | null, compatibleBase: CompatibleBase, hdr10Plus: MetadataPresence, bitstreamRewrites: Array<BitstreamRewrite>, dolbyVision: { presence: MetadataPresence, profile: number | null, level: number | null, baseLayerCompatibilityId: number | null, enhancementLayer: DolbyVisionEnhancementLayer | null, observedRpu: MetadataPresence | null }, masteringDisplay: { minLuminance: number, maxLuminance: number } | null, contentLightLevel: { maxContentLightLevel: number, maxFrameAverageLightLevel: number } | null } | null } }, audio: { delivery: PlaybackDelivery, source: { codec: string, channels: number | null, bitrate: number | null }, output: { codec: string, channels: number | null, bitrate: number | null } } | null };

export type VideoFormatFieldsFragment = { codec: string, width: number, height: number, frameRate: number | null, bitrate: number | null, videoRange: VideoRange, dolbyVision: boolean, details: { codecProfile: VideoCodecProfile | null, codecLevel: number | null, bitDepth: number | null, chromaSubsampling: ChromaSubsampling | null, compatibleBase: CompatibleBase, hdr10Plus: MetadataPresence, bitstreamRewrites: Array<BitstreamRewrite>, dolbyVision: { presence: MetadataPresence, profile: number | null, level: number | null, baseLayerCompatibilityId: number | null, enhancementLayer: DolbyVisionEnhancementLayer | null, observedRpu: MetadataPresence | null }, masteringDisplay: { minLuminance: number, maxLuminance: number } | null, contentLightLevel: { maxContentLightLevel: number, maxFrameAverageLightLevel: number } | null } | null };

export type AudioFormatFieldsFragment = { codec: string, channels: number | null, bitrate: number | null };

export type PlaybackDecisionsQueryVariables = Exact<{
  id: string | number;
}>;


export type PlaybackDecisionsQuery = { playbackSession: { id: string, decisions: Array<{ formatAttempt: number, streamSessionId: string, reasons: Array<DecisionReason>, video: { delivery: PlaybackDelivery, source: { codec: string, width: number, height: number, frameRate: number | null, bitrate: number | null, videoRange: VideoRange, dolbyVision: boolean, details: { codecProfile: VideoCodecProfile | null, codecLevel: number | null, bitDepth: number | null, chromaSubsampling: ChromaSubsampling | null, compatibleBase: CompatibleBase, hdr10Plus: MetadataPresence, bitstreamRewrites: Array<BitstreamRewrite>, dolbyVision: { presence: MetadataPresence, profile: number | null, level: number | null, baseLayerCompatibilityId: number | null, enhancementLayer: DolbyVisionEnhancementLayer | null, observedRpu: MetadataPresence | null }, masteringDisplay: { minLuminance: number, maxLuminance: number } | null, contentLightLevel: { maxContentLightLevel: number, maxFrameAverageLightLevel: number } | null } | null }, output: { codec: string, width: number, height: number, frameRate: number | null, bitrate: number | null, videoRange: VideoRange, dolbyVision: boolean, details: { codecProfile: VideoCodecProfile | null, codecLevel: number | null, bitDepth: number | null, chromaSubsampling: ChromaSubsampling | null, compatibleBase: CompatibleBase, hdr10Plus: MetadataPresence, bitstreamRewrites: Array<BitstreamRewrite>, dolbyVision: { presence: MetadataPresence, profile: number | null, level: number | null, baseLayerCompatibilityId: number | null, enhancementLayer: DolbyVisionEnhancementLayer | null, observedRpu: MetadataPresence | null }, masteringDisplay: { minLuminance: number, maxLuminance: number } | null, contentLightLevel: { maxContentLightLevel: number, maxFrameAverageLightLevel: number } | null } | null } }, audio: { delivery: PlaybackDelivery, source: { codec: string, channels: number | null, bitrate: number | null }, output: { codec: string, channels: number | null, bitrate: number | null } } | null }> } | null };

export type PlaybackSessionQueryVariables = Exact<{
  id: string | number;
}>;


export type PlaybackSessionQuery = { playbackSession: { id: string, formatAttemptCount: number, maximumFormatAttempts: number, requestedChoice: VideoQuality, playbackChoice: VideoQuality, formatChange: PlaybackFormatChange | null, offeredChoices: Array<VideoQuality>, currentFormatAttempt:
      | { __typename: 'FailedPlaybackFormatAttempt', streamSessionId: string, error:
          | { __typename: 'InvalidMediaFileError', message: string }
          | { __typename: 'MediaFileFrameRateUnknownError', message: string }
          | { __typename: 'MediaFileHasNoVideoError', message: string }
          | { __typename: 'MediaFileNotFoundError', message: string }
          | { __typename: 'MediaFileProbeNotReadyError', message: string }
          | { __typename: 'NoEligibleVideoFormatError', message: string }
          | { __typename: 'PlaybackFormatAttemptsExhaustedError', message: string }
          | { __typename: 'PlaybackFormatRejectedError', message: string }
          | { __typename: 'PlaybackInvalidSpecificationError', message: string }
          | { __typename: 'PlaybackOutputMismatchError', message: string }
          | { __typename: 'PlaybackStartupFailedError', message: string }
          | { __typename: 'StartPositionOutOfRangeError', message: string }
          | { __typename: 'TranscodeCapacityUnavailableError', message: string }
         }
      | { __typename: 'PendingPlaybackFormatAttempt', streamSessionId: string }
      | { __typename: 'ReadyPlaybackFormatAttempt', streamSession:
          | { __typename: 'DirectPlayStreamSession', sourceContainer: SourceContainer, videoRange: VideoRange, startPositionSeconds: number | null, audioTrackPosition: number | null, id: string, streamUrl: string, audioTracks: Array<{ position: number, language: string | null, title: string | null }> }
          | { __typename: 'HlsStreamSession', transcodeMode: TranscodeMode, videoRange: VideoRange, mediaEndSeconds: number | null, id: string, streamUrl: string }
         }
     } | null };

export type PlaybackSessionFieldsFragment = { id: string, formatAttemptCount: number, maximumFormatAttempts: number, requestedChoice: VideoQuality, playbackChoice: VideoQuality, formatChange: PlaybackFormatChange | null, offeredChoices: Array<VideoQuality>, currentFormatAttempt:
    | { __typename: 'FailedPlaybackFormatAttempt', streamSessionId: string, error:
        | { __typename: 'InvalidMediaFileError', message: string }
        | { __typename: 'MediaFileFrameRateUnknownError', message: string }
        | { __typename: 'MediaFileHasNoVideoError', message: string }
        | { __typename: 'MediaFileNotFoundError', message: string }
        | { __typename: 'MediaFileProbeNotReadyError', message: string }
        | { __typename: 'NoEligibleVideoFormatError', message: string }
        | { __typename: 'PlaybackFormatAttemptsExhaustedError', message: string }
        | { __typename: 'PlaybackFormatRejectedError', message: string }
        | { __typename: 'PlaybackInvalidSpecificationError', message: string }
        | { __typename: 'PlaybackOutputMismatchError', message: string }
        | { __typename: 'PlaybackStartupFailedError', message: string }
        | { __typename: 'StartPositionOutOfRangeError', message: string }
        | { __typename: 'TranscodeCapacityUnavailableError', message: string }
       }
    | { __typename: 'PendingPlaybackFormatAttempt', streamSessionId: string }
    | { __typename: 'ReadyPlaybackFormatAttempt', streamSession:
        | { __typename: 'DirectPlayStreamSession', sourceContainer: SourceContainer, videoRange: VideoRange, startPositionSeconds: number | null, audioTrackPosition: number | null, id: string, streamUrl: string, audioTracks: Array<{ position: number, language: string | null, title: string | null }> }
        | { __typename: 'HlsStreamSession', transcodeMode: TranscodeMode, videoRange: VideoRange, mediaEndSeconds: number | null, id: string, streamUrl: string }
       }
   };

export type PlayerSubtitleModesQueryVariables = Exact<{
  id: string | number;
  movie: boolean;
}>;


export type PlayerSubtitleModesQuery = { movie?: { __typename: 'Movie', id: string, selectedProfileState: { languagePreference: { __typename: 'LanguagePreference', audioLanguages: Array<Language>, subtitleLanguage: Language | null, subtitleMode: SubtitleMode, audioSource: PreferenceSource, subtitleSource: PreferenceSource } } | null } | null, episode?: { __typename: 'Episode', id: string, selectedProfileState: { languagePreference: { __typename: 'LanguagePreference', audioLanguages: Array<Language>, subtitleLanguage: Language | null, subtitleMode: SubtitleMode, audioSource: PreferenceSource, subtitleSource: PreferenceSource } } | null, season: { __typename: 'Season', id: string, selectedProfileState: { languagePreference: { __typename: 'LanguagePreference', audioLanguages: Array<Language>, subtitleLanguage: Language | null, subtitleMode: SubtitleMode, audioSource: PreferenceSource, subtitleSource: PreferenceSource } } | null } } | null, me: { __typename: 'Me', languagePreferences: { __typename: 'ProfileLanguagePreferences', audioLanguages: Array<Language>, subtitleLanguage: Language | null, subtitleMode: SubtitleMode } | null } };

export type PlayerMediaTitleQueryVariables = Exact<{
  id: string | number;
  movie: boolean;
}>;


export type PlayerMediaTitleQuery = { movie?: { id: string, title: string | null } | null, episode?: { id: string, title: string | null, episodeNumber: number, season: { id: string, seasonNumber: number, series: { id: string, title: string | null } } } | null };

export type ReportPlaybackFormatFailureMutationVariables = Exact<{
  input: ReportPlaybackFormatFailureInput;
}>;


export type ReportPlaybackFormatFailureMutation = { reportPlaybackFormatFailure: { playbackSession: { id: string, formatAttemptCount: number, maximumFormatAttempts: number, requestedChoice: VideoQuality, playbackChoice: VideoQuality, formatChange: PlaybackFormatChange | null, offeredChoices: Array<VideoQuality>, currentFormatAttempt:
        | { __typename: 'FailedPlaybackFormatAttempt', streamSessionId: string, error:
            | { __typename: 'InvalidMediaFileError', message: string }
            | { __typename: 'MediaFileFrameRateUnknownError', message: string }
            | { __typename: 'MediaFileHasNoVideoError', message: string }
            | { __typename: 'MediaFileNotFoundError', message: string }
            | { __typename: 'MediaFileProbeNotReadyError', message: string }
            | { __typename: 'NoEligibleVideoFormatError', message: string }
            | { __typename: 'PlaybackFormatAttemptsExhaustedError', message: string }
            | { __typename: 'PlaybackFormatRejectedError', message: string }
            | { __typename: 'PlaybackInvalidSpecificationError', message: string }
            | { __typename: 'PlaybackOutputMismatchError', message: string }
            | { __typename: 'PlaybackStartupFailedError', message: string }
            | { __typename: 'StartPositionOutOfRangeError', message: string }
            | { __typename: 'TranscodeCapacityUnavailableError', message: string }
           }
        | { __typename: 'PendingPlaybackFormatAttempt', streamSessionId: string }
        | { __typename: 'ReadyPlaybackFormatAttempt', streamSession:
            | { __typename: 'DirectPlayStreamSession', sourceContainer: SourceContainer, videoRange: VideoRange, startPositionSeconds: number | null, audioTrackPosition: number | null, id: string, streamUrl: string, audioTracks: Array<{ position: number, language: string | null, title: string | null }> }
            | { __typename: 'HlsStreamSession', transcodeMode: TranscodeMode, videoRange: VideoRange, mediaEndSeconds: number | null, id: string, streamUrl: string }
           }
       } | null, userErrors: Array<
      | { __typename: 'InvalidIdError', message: string }
      | { __typename: 'PlaybackSessionClosedError', message: string }
    > } | null };

export type SwitchPlaybackAudioTrackMutationVariables = Exact<{
  input: SwitchPlaybackAudioTrackInput;
}>;


export type SwitchPlaybackAudioTrackMutation = { switchPlaybackAudioTrack: { playbackSession: { id: string, formatAttemptCount: number, maximumFormatAttempts: number, requestedChoice: VideoQuality, playbackChoice: VideoQuality, formatChange: PlaybackFormatChange | null, offeredChoices: Array<VideoQuality>, currentFormatAttempt:
        | { __typename: 'FailedPlaybackFormatAttempt', streamSessionId: string, error:
            | { __typename: 'InvalidMediaFileError', message: string }
            | { __typename: 'MediaFileFrameRateUnknownError', message: string }
            | { __typename: 'MediaFileHasNoVideoError', message: string }
            | { __typename: 'MediaFileNotFoundError', message: string }
            | { __typename: 'MediaFileProbeNotReadyError', message: string }
            | { __typename: 'NoEligibleVideoFormatError', message: string }
            | { __typename: 'PlaybackFormatAttemptsExhaustedError', message: string }
            | { __typename: 'PlaybackFormatRejectedError', message: string }
            | { __typename: 'PlaybackInvalidSpecificationError', message: string }
            | { __typename: 'PlaybackOutputMismatchError', message: string }
            | { __typename: 'PlaybackStartupFailedError', message: string }
            | { __typename: 'StartPositionOutOfRangeError', message: string }
            | { __typename: 'TranscodeCapacityUnavailableError', message: string }
           }
        | { __typename: 'PendingPlaybackFormatAttempt', streamSessionId: string }
        | { __typename: 'ReadyPlaybackFormatAttempt', streamSession:
            | { __typename: 'DirectPlayStreamSession', sourceContainer: SourceContainer, videoRange: VideoRange, startPositionSeconds: number | null, audioTrackPosition: number | null, id: string, streamUrl: string, audioTracks: Array<{ position: number, language: string | null, title: string | null }> }
            | { __typename: 'HlsStreamSession', transcodeMode: TranscodeMode, videoRange: VideoRange, mediaEndSeconds: number | null, id: string, streamUrl: string }
           }
       } | null, userErrors: Array<
      | { __typename: 'AudioTrackNotInFileError', message: string }
      | { __typename: 'InvalidIdError', message: string }
      | { __typename: 'InvalidMediaFileError', message: string }
      | { __typename: 'MediaFileFrameRateUnknownError', message: string }
      | { __typename: 'MediaFileHasNoVideoError', message: string }
      | { __typename: 'MediaFileNotFoundError', message: string }
      | { __typename: 'MediaFileProbeNotReadyError', message: string }
      | { __typename: 'NoEligibleVideoFormatError', message: string }
      | { __typename: 'PlaybackSessionClosedError', message: string }
      | { __typename: 'PlaybackStartupFailedError', message: string }
      | { __typename: 'StartPositionOutOfRangeError', message: string }
      | { __typename: 'TranscodeCapacityUnavailableError', message: string }
    > } | null };

export const EncoderPresetSettingFieldsFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"EncoderPresetSettingFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"EncoderPresetSetting"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"preset"}},{"kind":"Field","name":{"kind":"Name","value":"automatic"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"h264"}},{"kind":"Field","name":{"kind":"Name","value":"hevc"}},{"kind":"Field","name":{"kind":"Name","value":"av1"}}]}}]}}]} as unknown as DocumentNode<EncoderPresetSettingFieldsFragment, unknown>;
export const IdleSegmentRetentionSettingFieldsFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"IdleSegmentRetentionSettingFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"IdleSegmentRetentionSetting"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"minutes"}},{"kind":"Field","name":{"kind":"Name","value":"minimumMinutes"}},{"kind":"Field","name":{"kind":"Name","value":"maximumMinutes"}}]}}]} as unknown as DocumentNode<IdleSegmentRetentionSettingFieldsFragment, unknown>;
export const NotificationRetentionSettingFieldsFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"NotificationRetentionSettingFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"NotificationRetentionSetting"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"days"}},{"kind":"Field","name":{"kind":"Name","value":"minimumDays"}},{"kind":"Field","name":{"kind":"Name","value":"maximumDays"}}]}}]} as unknown as DocumentNode<NotificationRetentionSettingFieldsFragment, unknown>;
export const ActiveStreamPosterFieldsFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"ActiveStreamPosterFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Image"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"aspectRatio"}},{"kind":"Field","name":{"kind":"Name","value":"blurHash"}},{"kind":"Field","name":{"kind":"Name","value":"variants"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"size"}},{"kind":"Field","name":{"kind":"Name","value":"width"}},{"kind":"Field","name":{"kind":"Name","value":"height"}},{"kind":"Field","name":{"kind":"Name","value":"url"}}]}}]}}]} as unknown as DocumentNode<ActiveStreamPosterFieldsFragment, unknown>;
export const VideoFormatFieldsFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"VideoFormatFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"VideoFormat"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"codec"}},{"kind":"Field","name":{"kind":"Name","value":"width"}},{"kind":"Field","name":{"kind":"Name","value":"height"}},{"kind":"Field","name":{"kind":"Name","value":"frameRate"}},{"kind":"Field","name":{"kind":"Name","value":"bitrate"}},{"kind":"Field","name":{"kind":"Name","value":"videoRange"}},{"kind":"Field","name":{"kind":"Name","value":"dolbyVision"}},{"kind":"Field","name":{"kind":"Name","value":"details"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"codecProfile"}},{"kind":"Field","name":{"kind":"Name","value":"codecLevel"}},{"kind":"Field","name":{"kind":"Name","value":"bitDepth"}},{"kind":"Field","name":{"kind":"Name","value":"chromaSubsampling"}},{"kind":"Field","name":{"kind":"Name","value":"compatibleBase"}},{"kind":"Field","name":{"kind":"Name","value":"hdr10Plus"}},{"kind":"Field","name":{"kind":"Name","value":"dolbyVision"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"presence"}},{"kind":"Field","name":{"kind":"Name","value":"profile"}},{"kind":"Field","name":{"kind":"Name","value":"level"}},{"kind":"Field","name":{"kind":"Name","value":"baseLayerCompatibilityId"}},{"kind":"Field","name":{"kind":"Name","value":"enhancementLayer"}},{"kind":"Field","name":{"kind":"Name","value":"observedRpu"}}]}},{"kind":"Field","name":{"kind":"Name","value":"masteringDisplay"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"minLuminance"}},{"kind":"Field","name":{"kind":"Name","value":"maxLuminance"}}]}},{"kind":"Field","name":{"kind":"Name","value":"contentLightLevel"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"maxContentLightLevel"}},{"kind":"Field","name":{"kind":"Name","value":"maxFrameAverageLightLevel"}}]}},{"kind":"Field","name":{"kind":"Name","value":"bitstreamRewrites"}}]}}]}}]} as unknown as DocumentNode<VideoFormatFieldsFragment, unknown>;
export const AudioFormatFieldsFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"AudioFormatFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"AudioFormat"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"codec"}},{"kind":"Field","name":{"kind":"Name","value":"channels"}},{"kind":"Field","name":{"kind":"Name","value":"bitrate"}}]}}]} as unknown as DocumentNode<AudioFormatFieldsFragment, unknown>;
export const PlaybackDecisionFieldsFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"PlaybackDecisionFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"PlaybackDecision"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"formatAttempt"}},{"kind":"Field","name":{"kind":"Name","value":"streamSessionId"}},{"kind":"Field","name":{"kind":"Name","value":"video"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"delivery"}},{"kind":"Field","name":{"kind":"Name","value":"source"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"VideoFormatFields"}}]}},{"kind":"Field","name":{"kind":"Name","value":"output"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"VideoFormatFields"}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"audio"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"delivery"}},{"kind":"Field","name":{"kind":"Name","value":"source"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"AudioFormatFields"}}]}},{"kind":"Field","name":{"kind":"Name","value":"output"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"AudioFormatFields"}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"reasons"}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"VideoFormatFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"VideoFormat"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"codec"}},{"kind":"Field","name":{"kind":"Name","value":"width"}},{"kind":"Field","name":{"kind":"Name","value":"height"}},{"kind":"Field","name":{"kind":"Name","value":"frameRate"}},{"kind":"Field","name":{"kind":"Name","value":"bitrate"}},{"kind":"Field","name":{"kind":"Name","value":"videoRange"}},{"kind":"Field","name":{"kind":"Name","value":"dolbyVision"}},{"kind":"Field","name":{"kind":"Name","value":"details"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"codecProfile"}},{"kind":"Field","name":{"kind":"Name","value":"codecLevel"}},{"kind":"Field","name":{"kind":"Name","value":"bitDepth"}},{"kind":"Field","name":{"kind":"Name","value":"chromaSubsampling"}},{"kind":"Field","name":{"kind":"Name","value":"compatibleBase"}},{"kind":"Field","name":{"kind":"Name","value":"hdr10Plus"}},{"kind":"Field","name":{"kind":"Name","value":"dolbyVision"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"presence"}},{"kind":"Field","name":{"kind":"Name","value":"profile"}},{"kind":"Field","name":{"kind":"Name","value":"level"}},{"kind":"Field","name":{"kind":"Name","value":"baseLayerCompatibilityId"}},{"kind":"Field","name":{"kind":"Name","value":"enhancementLayer"}},{"kind":"Field","name":{"kind":"Name","value":"observedRpu"}}]}},{"kind":"Field","name":{"kind":"Name","value":"masteringDisplay"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"minLuminance"}},{"kind":"Field","name":{"kind":"Name","value":"maxLuminance"}}]}},{"kind":"Field","name":{"kind":"Name","value":"contentLightLevel"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"maxContentLightLevel"}},{"kind":"Field","name":{"kind":"Name","value":"maxFrameAverageLightLevel"}}]}},{"kind":"Field","name":{"kind":"Name","value":"bitstreamRewrites"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"AudioFormatFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"AudioFormat"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"codec"}},{"kind":"Field","name":{"kind":"Name","value":"channels"}},{"kind":"Field","name":{"kind":"Name","value":"bitrate"}}]}}]} as unknown as DocumentNode<PlaybackDecisionFieldsFragment, unknown>;
export const ActiveStreamFieldsFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"ActiveStreamFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"ActiveStream"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"playbackSessionId"}},{"kind":"Field","name":{"kind":"Name","value":"profile"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}}]}},{"kind":"Field","name":{"kind":"Name","value":"deviceName"}},{"kind":"Field","name":{"kind":"Name","value":"mediaFileId"}},{"kind":"Field","name":{"kind":"Name","value":"media"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Movie"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"runtime"}},{"kind":"Field","name":{"kind":"Name","value":"images"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"type"},"value":{"kind":"EnumValue","value":"POSTER"}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"ActiveStreamPosterFields"}}]}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Episode"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"episodeNumber"}},{"kind":"Field","name":{"kind":"Name","value":"runtime"}},{"kind":"Field","name":{"kind":"Name","value":"season"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"seasonNumber"}},{"kind":"Field","name":{"kind":"Name","value":"series"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"images"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"type"},"value":{"kind":"EnumValue","value":"POSTER"}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"ActiveStreamPosterFields"}}]}}]}}]}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"positionSeconds"}},{"kind":"Field","name":{"kind":"Name","value":"producedRange"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"startSeconds"}},{"kind":"Field","name":{"kind":"Name","value":"endSeconds"}}]}},{"kind":"Field","name":{"kind":"Name","value":"state"}},{"kind":"Field","name":{"kind":"Name","value":"decision"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"PlaybackDecisionFields"}}]}},{"kind":"Field","name":{"kind":"Name","value":"workers"}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"VideoFormatFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"VideoFormat"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"codec"}},{"kind":"Field","name":{"kind":"Name","value":"width"}},{"kind":"Field","name":{"kind":"Name","value":"height"}},{"kind":"Field","name":{"kind":"Name","value":"frameRate"}},{"kind":"Field","name":{"kind":"Name","value":"bitrate"}},{"kind":"Field","name":{"kind":"Name","value":"videoRange"}},{"kind":"Field","name":{"kind":"Name","value":"dolbyVision"}},{"kind":"Field","name":{"kind":"Name","value":"details"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"codecProfile"}},{"kind":"Field","name":{"kind":"Name","value":"codecLevel"}},{"kind":"Field","name":{"kind":"Name","value":"bitDepth"}},{"kind":"Field","name":{"kind":"Name","value":"chromaSubsampling"}},{"kind":"Field","name":{"kind":"Name","value":"compatibleBase"}},{"kind":"Field","name":{"kind":"Name","value":"hdr10Plus"}},{"kind":"Field","name":{"kind":"Name","value":"dolbyVision"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"presence"}},{"kind":"Field","name":{"kind":"Name","value":"profile"}},{"kind":"Field","name":{"kind":"Name","value":"level"}},{"kind":"Field","name":{"kind":"Name","value":"baseLayerCompatibilityId"}},{"kind":"Field","name":{"kind":"Name","value":"enhancementLayer"}},{"kind":"Field","name":{"kind":"Name","value":"observedRpu"}}]}},{"kind":"Field","name":{"kind":"Name","value":"masteringDisplay"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"minLuminance"}},{"kind":"Field","name":{"kind":"Name","value":"maxLuminance"}}]}},{"kind":"Field","name":{"kind":"Name","value":"contentLightLevel"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"maxContentLightLevel"}},{"kind":"Field","name":{"kind":"Name","value":"maxFrameAverageLightLevel"}}]}},{"kind":"Field","name":{"kind":"Name","value":"bitstreamRewrites"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"AudioFormatFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"AudioFormat"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"codec"}},{"kind":"Field","name":{"kind":"Name","value":"channels"}},{"kind":"Field","name":{"kind":"Name","value":"bitrate"}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"ActiveStreamPosterFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Image"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"aspectRatio"}},{"kind":"Field","name":{"kind":"Name","value":"blurHash"}},{"kind":"Field","name":{"kind":"Name","value":"variants"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"size"}},{"kind":"Field","name":{"kind":"Name","value":"width"}},{"kind":"Field","name":{"kind":"Name","value":"height"}},{"kind":"Field","name":{"kind":"Name","value":"url"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"PlaybackDecisionFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"PlaybackDecision"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"formatAttempt"}},{"kind":"Field","name":{"kind":"Name","value":"streamSessionId"}},{"kind":"Field","name":{"kind":"Name","value":"video"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"delivery"}},{"kind":"Field","name":{"kind":"Name","value":"source"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"VideoFormatFields"}}]}},{"kind":"Field","name":{"kind":"Name","value":"output"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"VideoFormatFields"}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"audio"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"delivery"}},{"kind":"Field","name":{"kind":"Name","value":"source"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"AudioFormatFields"}}]}},{"kind":"Field","name":{"kind":"Name","value":"output"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"AudioFormatFields"}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"reasons"}}]}}]} as unknown as DocumentNode<ActiveStreamFieldsFragment, unknown>;
export const SharedProfileFieldsFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"SharedProfileFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"ProfileSummary"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"picture"}},{"kind":"Field","name":{"kind":"Name","value":"kind"}},{"kind":"Field","name":{"kind":"Name","value":"personalProfile"}},{"kind":"Field","name":{"kind":"Name","value":"restricted"}}]}}]} as unknown as DocumentNode<SharedProfileFieldsFragment, unknown>;
export const VisitorShareFieldsFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"VisitorShareFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"ProfileShare"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"profileId"}},{"kind":"Field","name":{"kind":"Name","value":"householdId"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"requiredByAccountMembership"}},{"kind":"Field","name":{"kind":"Name","value":"profile"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SharedProfileFields"}}]}},{"kind":"Field","name":{"kind":"Name","value":"offeredByDisplayName"}},{"kind":"Field","name":{"kind":"Name","value":"visitor"}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"SharedProfileFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"ProfileSummary"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"picture"}},{"kind":"Field","name":{"kind":"Name","value":"kind"}},{"kind":"Field","name":{"kind":"Name","value":"personalProfile"}},{"kind":"Field","name":{"kind":"Name","value":"restricted"}}]}}]} as unknown as DocumentNode<VisitorShareFieldsFragment, unknown>;
export const LibraryFieldsFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"LibraryFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Library"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"type"}},{"kind":"Field","name":{"kind":"Name","value":"backend"}}]}}]} as unknown as DocumentNode<LibraryFieldsFragment, unknown>;
export const AdminLibraryFieldsFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"AdminLibraryFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Library"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"LibraryFields"}},{"kind":"Field","name":{"kind":"Name","value":"administration"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"filepathUri"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"scanStartedOn"}},{"kind":"Field","name":{"kind":"Name","value":"scanCompletedOn"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"LibraryFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Library"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"type"}},{"kind":"Field","name":{"kind":"Name","value":"backend"}}]}}]} as unknown as DocumentNode<AdminLibraryFieldsFragment, unknown>;
export const ShareOfferFieldsFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"ShareOfferFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"ProfileShare"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"profileId"}},{"kind":"Field","name":{"kind":"Name","value":"householdId"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"expiresAt"}},{"kind":"Field","name":{"kind":"Name","value":"profile"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SharedProfileFields"}}]}},{"kind":"Field","name":{"kind":"Name","value":"offeredByDisplayName"}},{"kind":"Field","name":{"kind":"Name","value":"visitor"}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"SharedProfileFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"ProfileSummary"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"picture"}},{"kind":"Field","name":{"kind":"Name","value":"kind"}},{"kind":"Field","name":{"kind":"Name","value":"personalProfile"}},{"kind":"Field","name":{"kind":"Name","value":"restricted"}}]}}]} as unknown as DocumentNode<ShareOfferFieldsFragment, unknown>;
export const ProfileShareFieldsFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"ProfileShareFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"ProfileShare"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"householdId"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"requiredByAccountMembership"}},{"kind":"Field","name":{"kind":"Name","value":"expiresAt"}},{"kind":"Field","name":{"kind":"Name","value":"endedAt"}},{"kind":"Field","name":{"kind":"Name","value":"invalidationReason"}},{"kind":"Field","name":{"kind":"Name","value":"household"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}}]}}]}}]} as unknown as DocumentNode<ProfileShareFieldsFragment, unknown>;
export const ShareCodeFieldsFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"ShareCodeFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"ShareCode"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"householdId"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"issuedAt"}},{"kind":"Field","name":{"kind":"Name","value":"expiresAt"}},{"kind":"Field","name":{"kind":"Name","value":"issuedByDisplayName"}}]}}]} as unknown as DocumentNode<ShareCodeFieldsFragment, unknown>;
export const OrderedEdgeFieldsFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"OrderedEdgeFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"OrderedEdge"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"cursor"}},{"kind":"Field","name":{"kind":"Name","value":"orderKey"}}]}}]} as unknown as DocumentNode<OrderedEdgeFieldsFragment, unknown>;
export const ImageWithAmbientFieldsFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"ImageWithAmbientFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Image"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"aspectRatio"}},{"kind":"Field","name":{"kind":"Name","value":"blurHash"}},{"kind":"Field","name":{"kind":"Name","value":"ambientColors"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"topLeft"}},{"kind":"Field","name":{"kind":"Name","value":"topRight"}},{"kind":"Field","name":{"kind":"Name","value":"bottomRight"}},{"kind":"Field","name":{"kind":"Name","value":"bottomLeft"}},{"kind":"Field","name":{"kind":"Name","value":"primary"}},{"kind":"Field","name":{"kind":"Name","value":"theme"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"base"}},{"kind":"Field","name":{"kind":"Name","value":"panel"}},{"kind":"Field","name":{"kind":"Name","value":"selected"}},{"kind":"Field","name":{"kind":"Name","value":"accent"}},{"kind":"Field","name":{"kind":"Name","value":"onAccent"}},{"kind":"Field","name":{"kind":"Name","value":"textPrimary"}},{"kind":"Field","name":{"kind":"Name","value":"textSecondary"}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"variants"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"size"}},{"kind":"Field","name":{"kind":"Name","value":"width"}},{"kind":"Field","name":{"kind":"Name","value":"height"}},{"kind":"Field","name":{"kind":"Name","value":"url"}}]}}]}}]} as unknown as DocumentNode<ImageWithAmbientFieldsFragment, unknown>;
export const ContinueWatchingItemFieldsFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"ContinueWatchingItemFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"ContinueWatchingMedia"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Movie"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"tagline"}},{"kind":"Field","name":{"kind":"Name","value":"summary"}},{"kind":"Field","name":{"kind":"Name","value":"runtime"}},{"kind":"Field","name":{"kind":"Name","value":"createdOn"}},{"kind":"Field","name":{"kind":"Name","value":"genres"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}}]}},{"kind":"Field","name":{"kind":"Name","value":"images"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"type"},"value":{"kind":"EnumValue","value":"BACKDROP"}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"ImageWithAmbientFields"}}]}},{"kind":"Field","name":{"kind":"Name","value":"selectedProfileState"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"watchState"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"watchProgress"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"positionSeconds"}},{"kind":"Field","name":{"kind":"Name","value":"percentComplete"}},{"kind":"Field","name":{"kind":"Name","value":"durationSeconds"}}]}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"files"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Episode"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"episodeNumber"}},{"kind":"Field","name":{"kind":"Name","value":"overview"}},{"kind":"Field","name":{"kind":"Name","value":"runtime"}},{"kind":"Field","name":{"kind":"Name","value":"images"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"type"},"value":{"kind":"EnumValue","value":"STILL"}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"aspectRatio"}},{"kind":"Field","name":{"kind":"Name","value":"blurHash"}},{"kind":"Field","name":{"kind":"Name","value":"variants"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"size"}},{"kind":"Field","name":{"kind":"Name","value":"width"}},{"kind":"Field","name":{"kind":"Name","value":"height"}},{"kind":"Field","name":{"kind":"Name","value":"url"}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"selectedProfileState"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"watchState"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"watchProgress"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"positionSeconds"}},{"kind":"Field","name":{"kind":"Name","value":"percentComplete"}},{"kind":"Field","name":{"kind":"Name","value":"durationSeconds"}}]}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"files"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}}]}},{"kind":"Field","name":{"kind":"Name","value":"season"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"seasonNumber"}},{"kind":"Field","name":{"kind":"Name","value":"series"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"tagline"}},{"kind":"Field","name":{"kind":"Name","value":"summary"}},{"kind":"Field","name":{"kind":"Name","value":"createdOn"}},{"kind":"Field","name":{"kind":"Name","value":"genres"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}}]}},{"kind":"Field","name":{"kind":"Name","value":"seasons"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}}]}},{"kind":"Field","name":{"kind":"Name","value":"images"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"type"},"value":{"kind":"EnumValue","value":"BACKDROP"}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"ImageWithAmbientFields"}}]}}]}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"ImageWithAmbientFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Image"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"aspectRatio"}},{"kind":"Field","name":{"kind":"Name","value":"blurHash"}},{"kind":"Field","name":{"kind":"Name","value":"ambientColors"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"topLeft"}},{"kind":"Field","name":{"kind":"Name","value":"topRight"}},{"kind":"Field","name":{"kind":"Name","value":"bottomRight"}},{"kind":"Field","name":{"kind":"Name","value":"bottomLeft"}},{"kind":"Field","name":{"kind":"Name","value":"primary"}},{"kind":"Field","name":{"kind":"Name","value":"theme"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"base"}},{"kind":"Field","name":{"kind":"Name","value":"panel"}},{"kind":"Field","name":{"kind":"Name","value":"selected"}},{"kind":"Field","name":{"kind":"Name","value":"accent"}},{"kind":"Field","name":{"kind":"Name","value":"onAccent"}},{"kind":"Field","name":{"kind":"Name","value":"textPrimary"}},{"kind":"Field","name":{"kind":"Name","value":"textSecondary"}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"variants"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"size"}},{"kind":"Field","name":{"kind":"Name","value":"width"}},{"kind":"Field","name":{"kind":"Name","value":"height"}},{"kind":"Field","name":{"kind":"Name","value":"url"}}]}}]}}]} as unknown as DocumentNode<ContinueWatchingItemFieldsFragment, unknown>;
export const ContinueWatchingEdgeFieldsFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"ContinueWatchingEdgeFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"ContinueWatchingEdge"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"OrderedEdgeFields"}},{"kind":"Field","name":{"kind":"Name","value":"node"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"ContinueWatchingItemFields"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"ImageWithAmbientFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Image"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"aspectRatio"}},{"kind":"Field","name":{"kind":"Name","value":"blurHash"}},{"kind":"Field","name":{"kind":"Name","value":"ambientColors"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"topLeft"}},{"kind":"Field","name":{"kind":"Name","value":"topRight"}},{"kind":"Field","name":{"kind":"Name","value":"bottomRight"}},{"kind":"Field","name":{"kind":"Name","value":"bottomLeft"}},{"kind":"Field","name":{"kind":"Name","value":"primary"}},{"kind":"Field","name":{"kind":"Name","value":"theme"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"base"}},{"kind":"Field","name":{"kind":"Name","value":"panel"}},{"kind":"Field","name":{"kind":"Name","value":"selected"}},{"kind":"Field","name":{"kind":"Name","value":"accent"}},{"kind":"Field","name":{"kind":"Name","value":"onAccent"}},{"kind":"Field","name":{"kind":"Name","value":"textPrimary"}},{"kind":"Field","name":{"kind":"Name","value":"textSecondary"}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"variants"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"size"}},{"kind":"Field","name":{"kind":"Name","value":"width"}},{"kind":"Field","name":{"kind":"Name","value":"height"}},{"kind":"Field","name":{"kind":"Name","value":"url"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"OrderedEdgeFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"OrderedEdge"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"cursor"}},{"kind":"Field","name":{"kind":"Name","value":"orderKey"}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"ContinueWatchingItemFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"ContinueWatchingMedia"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Movie"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"tagline"}},{"kind":"Field","name":{"kind":"Name","value":"summary"}},{"kind":"Field","name":{"kind":"Name","value":"runtime"}},{"kind":"Field","name":{"kind":"Name","value":"createdOn"}},{"kind":"Field","name":{"kind":"Name","value":"genres"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}}]}},{"kind":"Field","name":{"kind":"Name","value":"images"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"type"},"value":{"kind":"EnumValue","value":"BACKDROP"}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"ImageWithAmbientFields"}}]}},{"kind":"Field","name":{"kind":"Name","value":"selectedProfileState"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"watchState"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"watchProgress"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"positionSeconds"}},{"kind":"Field","name":{"kind":"Name","value":"percentComplete"}},{"kind":"Field","name":{"kind":"Name","value":"durationSeconds"}}]}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"files"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Episode"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"episodeNumber"}},{"kind":"Field","name":{"kind":"Name","value":"overview"}},{"kind":"Field","name":{"kind":"Name","value":"runtime"}},{"kind":"Field","name":{"kind":"Name","value":"images"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"type"},"value":{"kind":"EnumValue","value":"STILL"}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"aspectRatio"}},{"kind":"Field","name":{"kind":"Name","value":"blurHash"}},{"kind":"Field","name":{"kind":"Name","value":"variants"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"size"}},{"kind":"Field","name":{"kind":"Name","value":"width"}},{"kind":"Field","name":{"kind":"Name","value":"height"}},{"kind":"Field","name":{"kind":"Name","value":"url"}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"selectedProfileState"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"watchState"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"watchProgress"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"positionSeconds"}},{"kind":"Field","name":{"kind":"Name","value":"percentComplete"}},{"kind":"Field","name":{"kind":"Name","value":"durationSeconds"}}]}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"files"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}}]}},{"kind":"Field","name":{"kind":"Name","value":"season"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"seasonNumber"}},{"kind":"Field","name":{"kind":"Name","value":"series"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"tagline"}},{"kind":"Field","name":{"kind":"Name","value":"summary"}},{"kind":"Field","name":{"kind":"Name","value":"createdOn"}},{"kind":"Field","name":{"kind":"Name","value":"genres"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}}]}},{"kind":"Field","name":{"kind":"Name","value":"seasons"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}}]}},{"kind":"Field","name":{"kind":"Name","value":"images"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"type"},"value":{"kind":"EnumValue","value":"BACKDROP"}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"ImageWithAmbientFields"}}]}}]}}]}}]}}]}}]} as unknown as DocumentNode<ContinueWatchingEdgeFieldsFragment, unknown>;
export const ProfileLanguagePreferencesFieldsFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"ProfileLanguagePreferencesFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"ProfileLanguagePreferences"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"audioLanguages"}},{"kind":"Field","name":{"kind":"Name","value":"subtitleLanguage"}},{"kind":"Field","name":{"kind":"Name","value":"subtitleMode"}}]}}]} as unknown as DocumentNode<ProfileLanguagePreferencesFieldsFragment, unknown>;
export const LanguagePreferenceFieldsFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"LanguagePreferenceFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"LanguagePreference"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"audioLanguages"}},{"kind":"Field","name":{"kind":"Name","value":"subtitleLanguage"}},{"kind":"Field","name":{"kind":"Name","value":"subtitleMode"}},{"kind":"Field","name":{"kind":"Name","value":"audioSource"}},{"kind":"Field","name":{"kind":"Name","value":"subtitleSource"}}]}}]} as unknown as DocumentNode<LanguagePreferenceFieldsFragment, unknown>;
export const MediaSummaryFieldsFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"MediaSummaryFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Media"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Movie"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"titleSort"}},{"kind":"Field","name":{"kind":"Name","value":"releaseDate"}},{"kind":"Field","name":{"kind":"Name","value":"runtime"}},{"kind":"Field","name":{"kind":"Name","value":"selectedProfileState"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"watchState"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"watchStatus"}},{"kind":"Field","name":{"kind":"Name","value":"lastWatchedAt"}},{"kind":"Field","name":{"kind":"Name","value":"watchProgress"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"percentComplete"}}]}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"images"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"type"},"value":{"kind":"EnumValue","value":"POSTER"}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"aspectRatio"}},{"kind":"Field","name":{"kind":"Name","value":"blurHash"}},{"kind":"Field","name":{"kind":"Name","value":"variants"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"size"}},{"kind":"Field","name":{"kind":"Name","value":"width"}},{"kind":"Field","name":{"kind":"Name","value":"height"}},{"kind":"Field","name":{"kind":"Name","value":"url"}}]}}]}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Series"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"titleSort"}},{"kind":"Field","name":{"kind":"Name","value":"firstAirDate"}},{"kind":"Field","name":{"kind":"Name","value":"seasons"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}}]}},{"kind":"Field","name":{"kind":"Name","value":"selectedProfileState"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"watchState"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"watchStatus"}},{"kind":"Field","name":{"kind":"Name","value":"lastWatchedAt"}},{"kind":"Field","name":{"kind":"Name","value":"watchProgress"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"percentComplete"}}]}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"images"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"type"},"value":{"kind":"EnumValue","value":"POSTER"}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"aspectRatio"}},{"kind":"Field","name":{"kind":"Name","value":"blurHash"}},{"kind":"Field","name":{"kind":"Name","value":"variants"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"size"}},{"kind":"Field","name":{"kind":"Name","value":"width"}},{"kind":"Field","name":{"kind":"Name","value":"height"}},{"kind":"Field","name":{"kind":"Name","value":"url"}}]}}]}}]}}]}}]} as unknown as DocumentNode<MediaSummaryFieldsFragment, unknown>;
export const LibraryItemChangeFieldsFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"LibraryItemChangeFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"LibraryItemChange"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"libraryId"}},{"kind":"Field","name":{"kind":"Name","value":"itemId"}},{"kind":"Field","name":{"kind":"Name","value":"kind"}},{"kind":"Field","name":{"kind":"Name","value":"item"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"MediaSummaryFields"}}]}},{"kind":"Field","name":{"kind":"Name","value":"edge"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"sort"},"value":{"kind":"Variable","name":{"kind":"Name","value":"sort"}}},{"kind":"Argument","name":{"kind":"Name","value":"filter"},"value":{"kind":"Variable","name":{"kind":"Name","value":"filter"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"OrderedEdgeFields"}},{"kind":"Field","name":{"kind":"Name","value":"node"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"MediaSummaryFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"MediaSummaryFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Media"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Movie"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"titleSort"}},{"kind":"Field","name":{"kind":"Name","value":"releaseDate"}},{"kind":"Field","name":{"kind":"Name","value":"runtime"}},{"kind":"Field","name":{"kind":"Name","value":"selectedProfileState"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"watchState"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"watchStatus"}},{"kind":"Field","name":{"kind":"Name","value":"lastWatchedAt"}},{"kind":"Field","name":{"kind":"Name","value":"watchProgress"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"percentComplete"}}]}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"images"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"type"},"value":{"kind":"EnumValue","value":"POSTER"}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"aspectRatio"}},{"kind":"Field","name":{"kind":"Name","value":"blurHash"}},{"kind":"Field","name":{"kind":"Name","value":"variants"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"size"}},{"kind":"Field","name":{"kind":"Name","value":"width"}},{"kind":"Field","name":{"kind":"Name","value":"height"}},{"kind":"Field","name":{"kind":"Name","value":"url"}}]}}]}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Series"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"titleSort"}},{"kind":"Field","name":{"kind":"Name","value":"firstAirDate"}},{"kind":"Field","name":{"kind":"Name","value":"seasons"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}}]}},{"kind":"Field","name":{"kind":"Name","value":"selectedProfileState"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"watchState"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"watchStatus"}},{"kind":"Field","name":{"kind":"Name","value":"lastWatchedAt"}},{"kind":"Field","name":{"kind":"Name","value":"watchProgress"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"percentComplete"}}]}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"images"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"type"},"value":{"kind":"EnumValue","value":"POSTER"}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"aspectRatio"}},{"kind":"Field","name":{"kind":"Name","value":"blurHash"}},{"kind":"Field","name":{"kind":"Name","value":"variants"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"size"}},{"kind":"Field","name":{"kind":"Name","value":"width"}},{"kind":"Field","name":{"kind":"Name","value":"height"}},{"kind":"Field","name":{"kind":"Name","value":"url"}}]}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"OrderedEdgeFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"OrderedEdge"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"cursor"}},{"kind":"Field","name":{"kind":"Name","value":"orderKey"}}]}}]} as unknown as DocumentNode<LibraryItemChangeFieldsFragment, unknown>;
export const WatchProgressFieldsFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"WatchProgressFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"WatchProgress"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"positionSeconds"}},{"kind":"Field","name":{"kind":"Name","value":"percentComplete"}},{"kind":"Field","name":{"kind":"Name","value":"durationSeconds"}}]}}]} as unknown as DocumentNode<WatchProgressFieldsFragment, unknown>;
export const WatchStateFieldsFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"WatchStateFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"WatchState"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"watchStatus"}},{"kind":"Field","name":{"kind":"Name","value":"watchProgress"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"WatchProgressFields"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"WatchProgressFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"WatchProgress"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"positionSeconds"}},{"kind":"Field","name":{"kind":"Name","value":"percentComplete"}},{"kind":"Field","name":{"kind":"Name","value":"durationSeconds"}}]}}]} as unknown as DocumentNode<WatchStateFieldsFragment, unknown>;
export const MovieWatchStateFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"MovieWatchState"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Movie"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"selectedProfileState"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"watchState"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"WatchStateFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"WatchProgressFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"WatchProgress"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"positionSeconds"}},{"kind":"Field","name":{"kind":"Name","value":"percentComplete"}},{"kind":"Field","name":{"kind":"Name","value":"durationSeconds"}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"WatchStateFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"WatchState"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"watchStatus"}},{"kind":"Field","name":{"kind":"Name","value":"watchProgress"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"WatchProgressFields"}}]}}]}}]} as unknown as DocumentNode<MovieWatchStateFragment, unknown>;
export const EpisodeWatchStateFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"EpisodeWatchState"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Episode"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"selectedProfileState"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"watchState"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"WatchStateFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"WatchProgressFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"WatchProgress"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"positionSeconds"}},{"kind":"Field","name":{"kind":"Name","value":"percentComplete"}},{"kind":"Field","name":{"kind":"Name","value":"durationSeconds"}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"WatchStateFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"WatchState"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"watchStatus"}},{"kind":"Field","name":{"kind":"Name","value":"watchProgress"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"WatchProgressFields"}}]}}]}}]} as unknown as DocumentNode<EpisodeWatchStateFragment, unknown>;
export const SeasonWatchStateFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"SeasonWatchState"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Season"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"selectedProfileState"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"watchState"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"WatchStateFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"WatchProgressFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"WatchProgress"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"positionSeconds"}},{"kind":"Field","name":{"kind":"Name","value":"percentComplete"}},{"kind":"Field","name":{"kind":"Name","value":"durationSeconds"}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"WatchStateFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"WatchState"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"watchStatus"}},{"kind":"Field","name":{"kind":"Name","value":"watchProgress"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"WatchProgressFields"}}]}}]}}]} as unknown as DocumentNode<SeasonWatchStateFragment, unknown>;
export const SeriesWatchStateFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"SeriesWatchState"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Series"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"selectedProfileState"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"watchState"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"WatchStateFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"WatchProgressFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"WatchProgress"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"positionSeconds"}},{"kind":"Field","name":{"kind":"Name","value":"percentComplete"}},{"kind":"Field","name":{"kind":"Name","value":"durationSeconds"}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"WatchStateFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"WatchState"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"watchStatus"}},{"kind":"Field","name":{"kind":"Name","value":"watchProgress"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"WatchProgressFields"}}]}}]}}]} as unknown as DocumentNode<SeriesWatchStateFragment, unknown>;
export const WatchStateItemFieldsFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"WatchStateItemFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"WatchStateItem"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Movie"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"MovieWatchState"}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Episode"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"EpisodeWatchState"}},{"kind":"Field","name":{"kind":"Name","value":"season"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SeasonWatchState"}},{"kind":"Field","name":{"kind":"Name","value":"series"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SeriesWatchState"}}]}}]}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Season"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SeasonWatchState"}},{"kind":"Field","name":{"kind":"Name","value":"episodes"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"EpisodeWatchState"}}]}},{"kind":"Field","name":{"kind":"Name","value":"series"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SeriesWatchState"}}]}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Series"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SeriesWatchState"}},{"kind":"Field","name":{"kind":"Name","value":"seasons"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SeasonWatchState"}},{"kind":"Field","name":{"kind":"Name","value":"episodes"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"EpisodeWatchState"}}]}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"WatchProgressFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"WatchProgress"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"positionSeconds"}},{"kind":"Field","name":{"kind":"Name","value":"percentComplete"}},{"kind":"Field","name":{"kind":"Name","value":"durationSeconds"}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"WatchStateFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"WatchState"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"watchStatus"}},{"kind":"Field","name":{"kind":"Name","value":"watchProgress"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"WatchProgressFields"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"MovieWatchState"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Movie"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"selectedProfileState"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"watchState"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"WatchStateFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"EpisodeWatchState"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Episode"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"selectedProfileState"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"watchState"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"WatchStateFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"SeasonWatchState"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Season"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"selectedProfileState"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"watchState"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"WatchStateFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"SeriesWatchState"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Series"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"selectedProfileState"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"watchState"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"WatchStateFields"}}]}}]}}]}}]} as unknown as DocumentNode<WatchStateItemFieldsFragment, unknown>;
export const NotificationFieldsFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"NotificationFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Notification"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"message"}},{"kind":"Field","name":{"kind":"Name","value":"latestEventAt"}},{"kind":"Field","name":{"kind":"Name","value":"unread"}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"RequestNotification"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"expiresAt"}},{"kind":"Field","name":{"kind":"Name","value":"resolution"}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"ProfileShareOfferedNotification"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"answer"}}]}}]}}]} as unknown as DocumentNode<NotificationFieldsFragment, unknown>;
export const NotificationEdgeFieldsFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"NotificationEdgeFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"NotificationEdge"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"OrderedEdgeFields"}},{"kind":"Field","name":{"kind":"Name","value":"node"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"NotificationFields"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"OrderedEdgeFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"OrderedEdge"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"cursor"}},{"kind":"Field","name":{"kind":"Name","value":"orderKey"}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"NotificationFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Notification"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"message"}},{"kind":"Field","name":{"kind":"Name","value":"latestEventAt"}},{"kind":"Field","name":{"kind":"Name","value":"unread"}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"RequestNotification"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"expiresAt"}},{"kind":"Field","name":{"kind":"Name","value":"resolution"}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"ProfileShareOfferedNotification"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"answer"}}]}}]}}]} as unknown as DocumentNode<NotificationEdgeFieldsFragment, unknown>;
export const PlaybackSessionFieldsFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"PlaybackSessionFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"PlaybackSession"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"formatAttemptCount"}},{"kind":"Field","name":{"kind":"Name","value":"maximumFormatAttempts"}},{"kind":"Field","name":{"kind":"Name","value":"requestedChoice"}},{"kind":"Field","name":{"kind":"Name","value":"playbackChoice"}},{"kind":"Field","name":{"kind":"Name","value":"formatChange"}},{"kind":"Field","name":{"kind":"Name","value":"offeredChoices"}},{"kind":"Field","name":{"kind":"Name","value":"currentFormatAttempt"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"PendingPlaybackFormatAttempt"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"streamSessionId"}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"ReadyPlaybackFormatAttempt"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"streamSession"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"streamUrl"}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"HlsStreamSession"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"transcodeMode"}},{"kind":"Field","name":{"kind":"Name","value":"videoRange"}},{"kind":"Field","name":{"kind":"Name","value":"mediaEndSeconds"}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"DirectPlayStreamSession"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"sourceContainer"}},{"kind":"Field","name":{"kind":"Name","value":"videoRange"}},{"kind":"Field","name":{"kind":"Name","value":"startPositionSeconds"}},{"kind":"Field","name":{"kind":"Name","value":"audioTrackPosition"}},{"kind":"Field","name":{"kind":"Name","value":"audioTracks"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"position"}},{"kind":"Field","name":{"kind":"Name","value":"language"}},{"kind":"Field","name":{"kind":"Name","value":"title"}}]}}]}}]}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"FailedPlaybackFormatAttempt"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"streamSessionId"}},{"kind":"Field","name":{"kind":"Name","value":"error"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"MutationError"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"message"}}]}}]}}]}}]}}]}}]} as unknown as DocumentNode<PlaybackSessionFieldsFragment, unknown>;
export const EncoderPresetSettingDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"EncoderPresetSetting"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"encoderPresetSetting"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"EncoderPresetSettingFields"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"EncoderPresetSettingFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"EncoderPresetSetting"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"preset"}},{"kind":"Field","name":{"kind":"Name","value":"automatic"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"h264"}},{"kind":"Field","name":{"kind":"Name","value":"hevc"}},{"kind":"Field","name":{"kind":"Name","value":"av1"}}]}}]}}]} as unknown as DocumentNode<EncoderPresetSettingQuery, EncoderPresetSettingQueryVariables>;
export const ChangeEncoderPresetDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"ChangeEncoderPreset"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ChangeEncoderPresetInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"changeEncoderPreset"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"encoderPresetSetting"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"EncoderPresetSettingFields"}}]}},{"kind":"Field","name":{"kind":"Name","value":"userErrors"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"MutationError"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"message"}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"InputMutationError"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"inputPath"}}]}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"EncoderPresetSettingFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"EncoderPresetSetting"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"preset"}},{"kind":"Field","name":{"kind":"Name","value":"automatic"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"h264"}},{"kind":"Field","name":{"kind":"Name","value":"hevc"}},{"kind":"Field","name":{"kind":"Name","value":"av1"}}]}}]}}]} as unknown as DocumentNode<ChangeEncoderPresetMutation, ChangeEncoderPresetMutationVariables>;
export const IdleSegmentRetentionSettingDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"IdleSegmentRetentionSetting"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"idleSegmentRetentionSetting"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"IdleSegmentRetentionSettingFields"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"IdleSegmentRetentionSettingFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"IdleSegmentRetentionSetting"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"minutes"}},{"kind":"Field","name":{"kind":"Name","value":"minimumMinutes"}},{"kind":"Field","name":{"kind":"Name","value":"maximumMinutes"}}]}}]} as unknown as DocumentNode<IdleSegmentRetentionSettingQuery, IdleSegmentRetentionSettingQueryVariables>;
export const ChangeIdleSegmentRetentionDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"ChangeIdleSegmentRetention"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ChangeIdleSegmentRetentionInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"changeIdleSegmentRetention"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"idleSegmentRetentionSetting"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"IdleSegmentRetentionSettingFields"}}]}},{"kind":"Field","name":{"kind":"Name","value":"userErrors"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"MutationError"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"message"}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"InputMutationError"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"inputPath"}}]}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"IdleSegmentRetentionSettingFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"IdleSegmentRetentionSetting"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"minutes"}},{"kind":"Field","name":{"kind":"Name","value":"minimumMinutes"}},{"kind":"Field","name":{"kind":"Name","value":"maximumMinutes"}}]}}]} as unknown as DocumentNode<ChangeIdleSegmentRetentionMutation, ChangeIdleSegmentRetentionMutationVariables>;
export const AdminLibrariesDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"AdminLibraries"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"libraries"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"AdminLibraryFields"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"LibraryFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Library"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"type"}},{"kind":"Field","name":{"kind":"Name","value":"backend"}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"AdminLibraryFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Library"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"LibraryFields"}},{"kind":"Field","name":{"kind":"Name","value":"administration"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"filepathUri"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"scanStartedOn"}},{"kind":"Field","name":{"kind":"Name","value":"scanCompletedOn"}}]}}]}}]} as unknown as DocumentNode<AdminLibrariesQuery, AdminLibrariesQueryVariables>;
export const AddLibraryDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"AddLibrary"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"AddLibraryInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"addLibrary"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"library"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"AdminLibraryFields"}}]}},{"kind":"Field","name":{"kind":"Name","value":"userErrors"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"MutationError"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"message"}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"InputMutationError"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"inputPath"}}]}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"LibraryFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Library"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"type"}},{"kind":"Field","name":{"kind":"Name","value":"backend"}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"AdminLibraryFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Library"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"LibraryFields"}},{"kind":"Field","name":{"kind":"Name","value":"administration"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"filepathUri"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"scanStartedOn"}},{"kind":"Field","name":{"kind":"Name","value":"scanCompletedOn"}}]}}]}}]} as unknown as DocumentNode<AddLibraryMutation, AddLibraryMutationVariables>;
export const StartLibraryScanDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"StartLibraryScan"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"StartLibraryScanInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"startLibraryScan"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"library"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"AdminLibraryFields"}}]}},{"kind":"Field","name":{"kind":"Name","value":"userErrors"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"MutationError"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"message"}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"LibraryBusyError"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"status"}}]}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"LibraryFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Library"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"type"}},{"kind":"Field","name":{"kind":"Name","value":"backend"}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"AdminLibraryFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Library"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"LibraryFields"}},{"kind":"Field","name":{"kind":"Name","value":"administration"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"filepathUri"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"scanStartedOn"}},{"kind":"Field","name":{"kind":"Name","value":"scanCompletedOn"}}]}}]}}]} as unknown as DocumentNode<StartLibraryScanMutation, StartLibraryScanMutationVariables>;
export const StartLibraryRefreshDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"StartLibraryRefresh"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"StartLibraryRefreshInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"startLibraryRefresh"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"library"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"AdminLibraryFields"}}]}},{"kind":"Field","name":{"kind":"Name","value":"userErrors"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"MutationError"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"message"}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"LibraryBusyError"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"status"}}]}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"LibraryFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Library"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"type"}},{"kind":"Field","name":{"kind":"Name","value":"backend"}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"AdminLibraryFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Library"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"LibraryFields"}},{"kind":"Field","name":{"kind":"Name","value":"administration"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"filepathUri"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"scanStartedOn"}},{"kind":"Field","name":{"kind":"Name","value":"scanCompletedOn"}}]}}]}}]} as unknown as DocumentNode<StartLibraryRefreshMutation, StartLibraryRefreshMutationVariables>;
export const StopLibraryScanDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"StopLibraryScan"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"StopLibraryScanInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"stopLibraryScan"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"library"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"AdminLibraryFields"}}]}},{"kind":"Field","name":{"kind":"Name","value":"userErrors"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"MutationError"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"message"}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"LibraryScanNotInProgressError"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"status"}}]}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"LibraryFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Library"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"type"}},{"kind":"Field","name":{"kind":"Name","value":"backend"}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"AdminLibraryFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Library"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"LibraryFields"}},{"kind":"Field","name":{"kind":"Name","value":"administration"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"filepathUri"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"scanStartedOn"}},{"kind":"Field","name":{"kind":"Name","value":"scanCompletedOn"}}]}}]}}]} as unknown as DocumentNode<StopLibraryScanMutation, StopLibraryScanMutationVariables>;
export const StopLibraryRefreshDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"StopLibraryRefresh"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"StopLibraryRefreshInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"stopLibraryRefresh"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"library"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"AdminLibraryFields"}}]}},{"kind":"Field","name":{"kind":"Name","value":"userErrors"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"MutationError"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"message"}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"LibraryRefreshNotInProgressError"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"status"}}]}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"LibraryFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Library"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"type"}},{"kind":"Field","name":{"kind":"Name","value":"backend"}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"AdminLibraryFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Library"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"LibraryFields"}},{"kind":"Field","name":{"kind":"Name","value":"administration"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"filepathUri"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"scanStartedOn"}},{"kind":"Field","name":{"kind":"Name","value":"scanCompletedOn"}}]}}]}}]} as unknown as DocumentNode<StopLibraryRefreshMutation, StopLibraryRefreshMutationVariables>;
export const RemoveLibraryDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"RemoveLibrary"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"RemoveLibraryInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"removeLibrary"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"removedLibraryId"}},{"kind":"Field","name":{"kind":"Name","value":"userErrors"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"MutationError"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"message"}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"LibraryBusyError"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"status"}}]}}]}}]}}]}}]} as unknown as DocumentNode<RemoveLibraryMutation, RemoveLibraryMutationVariables>;
export const NotificationRetentionSettingDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"NotificationRetentionSetting"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"notificationRetentionSetting"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"NotificationRetentionSettingFields"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"NotificationRetentionSettingFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"NotificationRetentionSetting"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"days"}},{"kind":"Field","name":{"kind":"Name","value":"minimumDays"}},{"kind":"Field","name":{"kind":"Name","value":"maximumDays"}}]}}]} as unknown as DocumentNode<NotificationRetentionSettingQuery, NotificationRetentionSettingQueryVariables>;
export const ChangeNotificationRetentionDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"ChangeNotificationRetention"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ChangeNotificationRetentionInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"changeNotificationRetention"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"notificationRetentionSetting"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"NotificationRetentionSettingFields"}}]}},{"kind":"Field","name":{"kind":"Name","value":"userErrors"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"MutationError"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"message"}}]}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"NotificationRetentionSettingFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"NotificationRetentionSetting"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"days"}},{"kind":"Field","name":{"kind":"Name","value":"minimumDays"}},{"kind":"Field","name":{"kind":"Name","value":"maximumDays"}}]}}]} as unknown as DocumentNode<ChangeNotificationRetentionMutation, ChangeNotificationRetentionMutationVariables>;
export const ActiveStreamsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"ActiveStreams"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"activeStreams"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"ActiveStreamFields"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"ActiveStreamPosterFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Image"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"aspectRatio"}},{"kind":"Field","name":{"kind":"Name","value":"blurHash"}},{"kind":"Field","name":{"kind":"Name","value":"variants"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"size"}},{"kind":"Field","name":{"kind":"Name","value":"width"}},{"kind":"Field","name":{"kind":"Name","value":"height"}},{"kind":"Field","name":{"kind":"Name","value":"url"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"VideoFormatFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"VideoFormat"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"codec"}},{"kind":"Field","name":{"kind":"Name","value":"width"}},{"kind":"Field","name":{"kind":"Name","value":"height"}},{"kind":"Field","name":{"kind":"Name","value":"frameRate"}},{"kind":"Field","name":{"kind":"Name","value":"bitrate"}},{"kind":"Field","name":{"kind":"Name","value":"videoRange"}},{"kind":"Field","name":{"kind":"Name","value":"dolbyVision"}},{"kind":"Field","name":{"kind":"Name","value":"details"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"codecProfile"}},{"kind":"Field","name":{"kind":"Name","value":"codecLevel"}},{"kind":"Field","name":{"kind":"Name","value":"bitDepth"}},{"kind":"Field","name":{"kind":"Name","value":"chromaSubsampling"}},{"kind":"Field","name":{"kind":"Name","value":"compatibleBase"}},{"kind":"Field","name":{"kind":"Name","value":"hdr10Plus"}},{"kind":"Field","name":{"kind":"Name","value":"dolbyVision"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"presence"}},{"kind":"Field","name":{"kind":"Name","value":"profile"}},{"kind":"Field","name":{"kind":"Name","value":"level"}},{"kind":"Field","name":{"kind":"Name","value":"baseLayerCompatibilityId"}},{"kind":"Field","name":{"kind":"Name","value":"enhancementLayer"}},{"kind":"Field","name":{"kind":"Name","value":"observedRpu"}}]}},{"kind":"Field","name":{"kind":"Name","value":"masteringDisplay"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"minLuminance"}},{"kind":"Field","name":{"kind":"Name","value":"maxLuminance"}}]}},{"kind":"Field","name":{"kind":"Name","value":"contentLightLevel"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"maxContentLightLevel"}},{"kind":"Field","name":{"kind":"Name","value":"maxFrameAverageLightLevel"}}]}},{"kind":"Field","name":{"kind":"Name","value":"bitstreamRewrites"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"AudioFormatFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"AudioFormat"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"codec"}},{"kind":"Field","name":{"kind":"Name","value":"channels"}},{"kind":"Field","name":{"kind":"Name","value":"bitrate"}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"PlaybackDecisionFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"PlaybackDecision"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"formatAttempt"}},{"kind":"Field","name":{"kind":"Name","value":"streamSessionId"}},{"kind":"Field","name":{"kind":"Name","value":"video"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"delivery"}},{"kind":"Field","name":{"kind":"Name","value":"source"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"VideoFormatFields"}}]}},{"kind":"Field","name":{"kind":"Name","value":"output"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"VideoFormatFields"}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"audio"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"delivery"}},{"kind":"Field","name":{"kind":"Name","value":"source"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"AudioFormatFields"}}]}},{"kind":"Field","name":{"kind":"Name","value":"output"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"AudioFormatFields"}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"reasons"}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"ActiveStreamFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"ActiveStream"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"playbackSessionId"}},{"kind":"Field","name":{"kind":"Name","value":"profile"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}}]}},{"kind":"Field","name":{"kind":"Name","value":"deviceName"}},{"kind":"Field","name":{"kind":"Name","value":"mediaFileId"}},{"kind":"Field","name":{"kind":"Name","value":"media"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Movie"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"runtime"}},{"kind":"Field","name":{"kind":"Name","value":"images"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"type"},"value":{"kind":"EnumValue","value":"POSTER"}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"ActiveStreamPosterFields"}}]}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Episode"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"episodeNumber"}},{"kind":"Field","name":{"kind":"Name","value":"runtime"}},{"kind":"Field","name":{"kind":"Name","value":"season"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"seasonNumber"}},{"kind":"Field","name":{"kind":"Name","value":"series"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"images"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"type"},"value":{"kind":"EnumValue","value":"POSTER"}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"ActiveStreamPosterFields"}}]}}]}}]}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"positionSeconds"}},{"kind":"Field","name":{"kind":"Name","value":"producedRange"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"startSeconds"}},{"kind":"Field","name":{"kind":"Name","value":"endSeconds"}}]}},{"kind":"Field","name":{"kind":"Name","value":"state"}},{"kind":"Field","name":{"kind":"Name","value":"decision"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"PlaybackDecisionFields"}}]}},{"kind":"Field","name":{"kind":"Name","value":"workers"}}]}}]} as unknown as DocumentNode<ActiveStreamsQuery, ActiveStreamsQueryVariables>;
export const ActiveStreamsChangedDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"subscription","name":{"kind":"Name","value":"ActiveStreamsChanged"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"activeStreamsChanged"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"playbackSessionId"}},{"kind":"Field","name":{"kind":"Name","value":"activeStream"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"ActiveStreamFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"ActiveStreamPosterFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Image"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"aspectRatio"}},{"kind":"Field","name":{"kind":"Name","value":"blurHash"}},{"kind":"Field","name":{"kind":"Name","value":"variants"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"size"}},{"kind":"Field","name":{"kind":"Name","value":"width"}},{"kind":"Field","name":{"kind":"Name","value":"height"}},{"kind":"Field","name":{"kind":"Name","value":"url"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"VideoFormatFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"VideoFormat"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"codec"}},{"kind":"Field","name":{"kind":"Name","value":"width"}},{"kind":"Field","name":{"kind":"Name","value":"height"}},{"kind":"Field","name":{"kind":"Name","value":"frameRate"}},{"kind":"Field","name":{"kind":"Name","value":"bitrate"}},{"kind":"Field","name":{"kind":"Name","value":"videoRange"}},{"kind":"Field","name":{"kind":"Name","value":"dolbyVision"}},{"kind":"Field","name":{"kind":"Name","value":"details"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"codecProfile"}},{"kind":"Field","name":{"kind":"Name","value":"codecLevel"}},{"kind":"Field","name":{"kind":"Name","value":"bitDepth"}},{"kind":"Field","name":{"kind":"Name","value":"chromaSubsampling"}},{"kind":"Field","name":{"kind":"Name","value":"compatibleBase"}},{"kind":"Field","name":{"kind":"Name","value":"hdr10Plus"}},{"kind":"Field","name":{"kind":"Name","value":"dolbyVision"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"presence"}},{"kind":"Field","name":{"kind":"Name","value":"profile"}},{"kind":"Field","name":{"kind":"Name","value":"level"}},{"kind":"Field","name":{"kind":"Name","value":"baseLayerCompatibilityId"}},{"kind":"Field","name":{"kind":"Name","value":"enhancementLayer"}},{"kind":"Field","name":{"kind":"Name","value":"observedRpu"}}]}},{"kind":"Field","name":{"kind":"Name","value":"masteringDisplay"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"minLuminance"}},{"kind":"Field","name":{"kind":"Name","value":"maxLuminance"}}]}},{"kind":"Field","name":{"kind":"Name","value":"contentLightLevel"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"maxContentLightLevel"}},{"kind":"Field","name":{"kind":"Name","value":"maxFrameAverageLightLevel"}}]}},{"kind":"Field","name":{"kind":"Name","value":"bitstreamRewrites"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"AudioFormatFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"AudioFormat"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"codec"}},{"kind":"Field","name":{"kind":"Name","value":"channels"}},{"kind":"Field","name":{"kind":"Name","value":"bitrate"}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"PlaybackDecisionFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"PlaybackDecision"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"formatAttempt"}},{"kind":"Field","name":{"kind":"Name","value":"streamSessionId"}},{"kind":"Field","name":{"kind":"Name","value":"video"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"delivery"}},{"kind":"Field","name":{"kind":"Name","value":"source"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"VideoFormatFields"}}]}},{"kind":"Field","name":{"kind":"Name","value":"output"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"VideoFormatFields"}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"audio"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"delivery"}},{"kind":"Field","name":{"kind":"Name","value":"source"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"AudioFormatFields"}}]}},{"kind":"Field","name":{"kind":"Name","value":"output"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"AudioFormatFields"}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"reasons"}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"ActiveStreamFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"ActiveStream"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"playbackSessionId"}},{"kind":"Field","name":{"kind":"Name","value":"profile"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}}]}},{"kind":"Field","name":{"kind":"Name","value":"deviceName"}},{"kind":"Field","name":{"kind":"Name","value":"mediaFileId"}},{"kind":"Field","name":{"kind":"Name","value":"media"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Movie"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"runtime"}},{"kind":"Field","name":{"kind":"Name","value":"images"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"type"},"value":{"kind":"EnumValue","value":"POSTER"}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"ActiveStreamPosterFields"}}]}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Episode"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"episodeNumber"}},{"kind":"Field","name":{"kind":"Name","value":"runtime"}},{"kind":"Field","name":{"kind":"Name","value":"season"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"seasonNumber"}},{"kind":"Field","name":{"kind":"Name","value":"series"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"images"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"type"},"value":{"kind":"EnumValue","value":"POSTER"}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"ActiveStreamPosterFields"}}]}}]}}]}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"positionSeconds"}},{"kind":"Field","name":{"kind":"Name","value":"producedRange"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"startSeconds"}},{"kind":"Field","name":{"kind":"Name","value":"endSeconds"}}]}},{"kind":"Field","name":{"kind":"Name","value":"state"}},{"kind":"Field","name":{"kind":"Name","value":"decision"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"PlaybackDecisionFields"}}]}},{"kind":"Field","name":{"kind":"Name","value":"workers"}}]}}]} as unknown as DocumentNode<ActiveStreamsChangedSubscription, ActiveStreamsChangedSubscriptionVariables>;
export const SharedWithHouseholdDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"SharedWithHousehold"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"householdId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"householdShares"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"householdId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"householdId"}}},{"kind":"Argument","name":{"kind":"Name","value":"statuses"},"value":{"kind":"ListValue","values":[{"kind":"EnumValue","value":"ACTIVE"}]}},{"kind":"Argument","name":{"kind":"Name","value":"visitorsOnly"},"value":{"kind":"BooleanValue","value":true}},{"kind":"Argument","name":{"kind":"Name","value":"first"},"value":{"kind":"IntValue","value":"50"}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"edges"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"node"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"VisitorShareFields"}}]}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"SharedProfileFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"ProfileSummary"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"picture"}},{"kind":"Field","name":{"kind":"Name","value":"kind"}},{"kind":"Field","name":{"kind":"Name","value":"personalProfile"}},{"kind":"Field","name":{"kind":"Name","value":"restricted"}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"VisitorShareFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"ProfileShare"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"profileId"}},{"kind":"Field","name":{"kind":"Name","value":"householdId"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"requiredByAccountMembership"}},{"kind":"Field","name":{"kind":"Name","value":"profile"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SharedProfileFields"}}]}},{"kind":"Field","name":{"kind":"Name","value":"offeredByDisplayName"}},{"kind":"Field","name":{"kind":"Name","value":"visitor"}}]}}]} as unknown as DocumentNode<SharedWithHouseholdQuery, SharedWithHouseholdQueryVariables>;
export const VisitorDevicesDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"VisitorDevices"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"householdId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"householdDevices"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"householdId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"householdId"}}},{"kind":"Argument","name":{"kind":"Name","value":"visitorsOnly"},"value":{"kind":"BooleanValue","value":true}},{"kind":"Argument","name":{"kind":"Name","value":"first"},"value":{"kind":"IntValue","value":"50"}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"edges"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"node"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"householdId"}},{"kind":"Field","name":{"kind":"Name","value":"displayName"}},{"kind":"Field","name":{"kind":"Name","value":"authorizingAccountDisplayName"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"pairedAt"}}]}}]}}]}}]}}]} as unknown as DocumentNode<VisitorDevicesQuery, VisitorDevicesQueryVariables>;
export const RevokeDeviceRegistrationDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"RevokeDeviceRegistration"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"RevokeDeviceRegistrationInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"revokeDeviceRegistration"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"registrationId"}},{"kind":"Field","name":{"kind":"Name","value":"userErrors"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"MutationError"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"message"}}]}}]}}]}}]}}]} as unknown as DocumentNode<RevokeDeviceRegistrationMutation, RevokeDeviceRegistrationMutationVariables>;
export const LibrariesDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"Libraries"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"libraries"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"type"}}]}}]}}]} as unknown as DocumentNode<LibrariesQuery, LibrariesQueryVariables>;
export const LibraryStatusChangedDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"subscription","name":{"kind":"Name","value":"LibraryStatusChanged"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"libraryStatusChanged"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"AdminLibraryFields"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"LibraryFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Library"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"type"}},{"kind":"Field","name":{"kind":"Name","value":"backend"}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"AdminLibraryFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Library"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"LibraryFields"}},{"kind":"Field","name":{"kind":"Name","value":"administration"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"filepathUri"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"scanStartedOn"}},{"kind":"Field","name":{"kind":"Name","value":"scanCompletedOn"}}]}}]}}]} as unknown as DocumentNode<LibraryStatusChangedSubscription, LibraryStatusChangedSubscriptionVariables>;
export const LibraryAddedDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"subscription","name":{"kind":"Name","value":"LibraryAdded"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"libraryAdded"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"LibraryFields"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"LibraryFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Library"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"type"}},{"kind":"Field","name":{"kind":"Name","value":"backend"}}]}}]} as unknown as DocumentNode<LibraryAddedSubscription, LibraryAddedSubscriptionVariables>;
export const AdminLibraryAddedDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"subscription","name":{"kind":"Name","value":"AdminLibraryAdded"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"libraryAdded"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"AdminLibraryFields"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"LibraryFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Library"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"type"}},{"kind":"Field","name":{"kind":"Name","value":"backend"}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"AdminLibraryFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Library"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"LibraryFields"}},{"kind":"Field","name":{"kind":"Name","value":"administration"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"filepathUri"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"scanStartedOn"}},{"kind":"Field","name":{"kind":"Name","value":"scanCompletedOn"}}]}}]}}]} as unknown as DocumentNode<AdminLibraryAddedSubscription, AdminLibraryAddedSubscriptionVariables>;
export const LibraryRemovedDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"subscription","name":{"kind":"Name","value":"LibraryRemoved"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"libraryRemoved"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"libraryId"}}]}}]}}]} as unknown as DocumentNode<LibraryRemovedSubscription, LibraryRemovedSubscriptionVariables>;
export const MeDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"Me"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"me"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"accountId"}},{"kind":"Field","name":{"kind":"Name","value":"email"}},{"kind":"Field","name":{"kind":"Name","value":"displayName"}},{"kind":"Field","name":{"kind":"Name","value":"serverAdmin"}},{"kind":"Field","name":{"kind":"Name","value":"scope"}},{"kind":"Field","name":{"kind":"Name","value":"deviceBound"}},{"kind":"Field","name":{"kind":"Name","value":"householdRole"}},{"kind":"Field","name":{"kind":"Name","value":"household"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}}]}},{"kind":"Field","name":{"kind":"Name","value":"contextHousehold"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}}]}},{"kind":"Field","name":{"kind":"Name","value":"usableHouseholds"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"first"},"value":{"kind":"IntValue","value":"20"}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"edges"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"node"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"membership"}},{"kind":"Field","name":{"kind":"Name","value":"household"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}}]}}]}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"selectableProfiles"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"first"},"value":{"kind":"IntValue","value":"100"}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"edges"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"node"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"picture"}},{"kind":"Field","name":{"kind":"Name","value":"kind"}},{"kind":"Field","name":{"kind":"Name","value":"personal"}},{"kind":"Field","name":{"kind":"Name","value":"pinConfigured"}},{"kind":"Field","name":{"kind":"Name","value":"locked"}},{"kind":"Field","name":{"kind":"Name","value":"selected"}}]}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"selectedProfile"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}}]}}]}}]}}]} as unknown as DocumentNode<MeQuery, MeQueryVariables>;
export const ShareOffersDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"ShareOffers"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"householdId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"householdShares"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"householdId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"householdId"}}},{"kind":"Argument","name":{"kind":"Name","value":"statuses"},"value":{"kind":"ListValue","values":[{"kind":"EnumValue","value":"PENDING"}]}},{"kind":"Argument","name":{"kind":"Name","value":"first"},"value":{"kind":"IntValue","value":"50"}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"edges"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"node"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"ShareOfferFields"}}]}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"SharedProfileFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"ProfileSummary"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"picture"}},{"kind":"Field","name":{"kind":"Name","value":"kind"}},{"kind":"Field","name":{"kind":"Name","value":"personalProfile"}},{"kind":"Field","name":{"kind":"Name","value":"restricted"}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"ShareOfferFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"ProfileShare"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"profileId"}},{"kind":"Field","name":{"kind":"Name","value":"householdId"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"expiresAt"}},{"kind":"Field","name":{"kind":"Name","value":"profile"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SharedProfileFields"}}]}},{"kind":"Field","name":{"kind":"Name","value":"offeredByDisplayName"}},{"kind":"Field","name":{"kind":"Name","value":"visitor"}}]}}]} as unknown as DocumentNode<ShareOffersQuery, ShareOffersQueryVariables>;
export const ProfileSharesDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"ProfileShares"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"profileId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"statuses"}},"type":{"kind":"NonNullType","type":{"kind":"ListType","type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ProfileShareStatus"}}}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"profileShares"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"profileId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"profileId"}}},{"kind":"Argument","name":{"kind":"Name","value":"statuses"},"value":{"kind":"Variable","name":{"kind":"Name","value":"statuses"}}},{"kind":"Argument","name":{"kind":"Name","value":"first"},"value":{"kind":"IntValue","value":"50"}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"edges"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"node"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"ProfileShareFields"}}]}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"ProfileShareFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"ProfileShare"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"householdId"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"requiredByAccountMembership"}},{"kind":"Field","name":{"kind":"Name","value":"expiresAt"}},{"kind":"Field","name":{"kind":"Name","value":"endedAt"}},{"kind":"Field","name":{"kind":"Name","value":"invalidationReason"}},{"kind":"Field","name":{"kind":"Name","value":"household"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}}]}}]}}]} as unknown as DocumentNode<ProfileSharesQuery, ProfileSharesQueryVariables>;
export const ProfileSharePreviewDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"ProfileSharePreview"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"profileId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"shareCode"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"profileSharePreview"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"profileId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"profileId"}}},{"kind":"Argument","name":{"kind":"Name","value":"shareCode"},"value":{"kind":"Variable","name":{"kind":"Name","value":"shareCode"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"wouldLock"}},{"kind":"Field","name":{"kind":"Name","value":"nameConflict"}}]}}]}}]} as unknown as DocumentNode<ProfileSharePreviewQuery, ProfileSharePreviewQueryVariables>;
export const LookUpShareCodeDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"LookUpShareCode"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"LookUpShareCodeInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"lookUpShareCode"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"householdName"}},{"kind":"Field","name":{"kind":"Name","value":"userErrors"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"MutationError"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"message"}}]}}]}}]}}]}}]} as unknown as DocumentNode<LookUpShareCodeMutation, LookUpShareCodeMutationVariables>;
export const OfferProfileShareDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"OfferProfileShare"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"OfferProfileShareInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"offerProfileShare"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"share"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"status"}}]}},{"kind":"Field","name":{"kind":"Name","value":"userErrors"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"MutationError"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"message"}}]}}]}}]}}]}}]} as unknown as DocumentNode<OfferProfileShareMutation, OfferProfileShareMutationVariables>;
export const AcceptProfileShareDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"AcceptProfileShare"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"AcceptProfileShareInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"acceptProfileShare"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"share"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"status"}}]}},{"kind":"Field","name":{"kind":"Name","value":"userErrors"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"MutationError"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"message"}}]}}]}}]}}]}}]} as unknown as DocumentNode<AcceptProfileShareMutation, AcceptProfileShareMutationVariables>;
export const RejectProfileShareDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"RejectProfileShare"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"RejectProfileShareInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"rejectProfileShare"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"share"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"status"}}]}},{"kind":"Field","name":{"kind":"Name","value":"userErrors"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"MutationError"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"message"}}]}}]}}]}}]}}]} as unknown as DocumentNode<RejectProfileShareMutation, RejectProfileShareMutationVariables>;
export const CancelProfileShareDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CancelProfileShare"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"CancelProfileShareInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"cancelProfileShare"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"share"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"status"}}]}},{"kind":"Field","name":{"kind":"Name","value":"userErrors"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"MutationError"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"message"}}]}}]}}]}}]}}]} as unknown as DocumentNode<CancelProfileShareMutation, CancelProfileShareMutationVariables>;
export const EndProfileShareDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"EndProfileShare"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"EndProfileShareInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"endProfileShare"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"share"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"status"}}]}},{"kind":"Field","name":{"kind":"Name","value":"userErrors"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"MutationError"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"message"}}]}}]}}]}}]}}]} as unknown as DocumentNode<EndProfileShareMutation, EndProfileShareMutationVariables>;
export const ProfileShareChangedDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"subscription","name":{"kind":"Name","value":"ProfileShareChanged"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"profileShareChanged"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"shareId"}},{"kind":"Field","name":{"kind":"Name","value":"share"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"ShareOfferFields"}},{"kind":"FragmentSpread","name":{"kind":"Name","value":"ProfileShareFields"}},{"kind":"FragmentSpread","name":{"kind":"Name","value":"VisitorShareFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"SharedProfileFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"ProfileSummary"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"picture"}},{"kind":"Field","name":{"kind":"Name","value":"kind"}},{"kind":"Field","name":{"kind":"Name","value":"personalProfile"}},{"kind":"Field","name":{"kind":"Name","value":"restricted"}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"ShareOfferFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"ProfileShare"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"profileId"}},{"kind":"Field","name":{"kind":"Name","value":"householdId"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"expiresAt"}},{"kind":"Field","name":{"kind":"Name","value":"profile"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SharedProfileFields"}}]}},{"kind":"Field","name":{"kind":"Name","value":"offeredByDisplayName"}},{"kind":"Field","name":{"kind":"Name","value":"visitor"}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"ProfileShareFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"ProfileShare"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"householdId"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"requiredByAccountMembership"}},{"kind":"Field","name":{"kind":"Name","value":"expiresAt"}},{"kind":"Field","name":{"kind":"Name","value":"endedAt"}},{"kind":"Field","name":{"kind":"Name","value":"invalidationReason"}},{"kind":"Field","name":{"kind":"Name","value":"household"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"VisitorShareFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"ProfileShare"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"profileId"}},{"kind":"Field","name":{"kind":"Name","value":"householdId"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"requiredByAccountMembership"}},{"kind":"Field","name":{"kind":"Name","value":"profile"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SharedProfileFields"}}]}},{"kind":"Field","name":{"kind":"Name","value":"offeredByDisplayName"}},{"kind":"Field","name":{"kind":"Name","value":"visitor"}}]}}]} as unknown as DocumentNode<ProfileShareChangedSubscription, ProfileShareChangedSubscriptionVariables>;
export const ReportStreamSessionTimelineDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"ReportStreamSessionTimeline"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"sessionId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"positionSeconds"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"state"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"PlaybackState"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"reportStreamSessionTimeline"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"sessionId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"sessionId"}}},{"kind":"Argument","name":{"kind":"Name","value":"positionSeconds"},"value":{"kind":"Variable","name":{"kind":"Name","value":"positionSeconds"}}},{"kind":"Argument","name":{"kind":"Name","value":"state"},"value":{"kind":"Variable","name":{"kind":"Name","value":"state"}}}]}]}}]} as unknown as DocumentNode<ReportStreamSessionTimelineMutation, ReportStreamSessionTimelineMutationVariables>;
export const HouseholdShareCodesDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"HouseholdShareCodes"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"householdId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"householdShareCodes"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"householdId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"householdId"}}},{"kind":"Argument","name":{"kind":"Name","value":"first"},"value":{"kind":"IntValue","value":"50"}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"edges"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"node"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"ShareCodeFields"}}]}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"ShareCodeFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"ShareCode"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"householdId"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"issuedAt"}},{"kind":"Field","name":{"kind":"Name","value":"expiresAt"}},{"kind":"Field","name":{"kind":"Name","value":"issuedByDisplayName"}}]}}]} as unknown as DocumentNode<HouseholdShareCodesQuery, HouseholdShareCodesQueryVariables>;
export const IssueShareCodeDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"IssueShareCode"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"IssueShareCodeInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"issueShareCode"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"issued"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"code"}},{"kind":"Field","name":{"kind":"Name","value":"shareCode"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"ShareCodeFields"}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"userErrors"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"MutationError"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"message"}}]}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"ShareCodeFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"ShareCode"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"householdId"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"issuedAt"}},{"kind":"Field","name":{"kind":"Name","value":"expiresAt"}},{"kind":"Field","name":{"kind":"Name","value":"issuedByDisplayName"}}]}}]} as unknown as DocumentNode<IssueShareCodeMutation, IssueShareCodeMutationVariables>;
export const WithdrawShareCodeDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"WithdrawShareCode"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"WithdrawShareCodeInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"withdrawShareCode"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"shareCode"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"status"}}]}},{"kind":"Field","name":{"kind":"Name","value":"userErrors"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"MutationError"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"message"}}]}}]}}]}}]}}]} as unknown as DocumentNode<WithdrawShareCodeMutation, WithdrawShareCodeMutationVariables>;
export const HomeDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"Home"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"continueWatchingFirst"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"continueWatching"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"first"},"value":{"kind":"Variable","name":{"kind":"Name","value":"continueWatchingFirst"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"edges"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"ContinueWatchingEdgeFields"}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"libraries"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"type"}},{"kind":"Field","name":{"kind":"Name","value":"items"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"first"},"value":{"kind":"IntValue","value":"18"}},{"kind":"Argument","name":{"kind":"Name","value":"sort"},"value":{"kind":"ObjectValue","fields":[{"kind":"ObjectField","name":{"kind":"Name","value":"by"},"value":{"kind":"EnumValue","value":"ADDED"}},{"kind":"ObjectField","name":{"kind":"Name","value":"direction"},"value":{"kind":"EnumValue","value":"DESC"}}]}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"edges"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"cursor"}},{"kind":"Field","name":{"kind":"Name","value":"node"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"MediaSummaryFields"}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Movie"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"tagline"}},{"kind":"Field","name":{"kind":"Name","value":"summary"}},{"kind":"Field","name":{"kind":"Name","value":"createdOn"}},{"kind":"Field","name":{"kind":"Name","value":"genres"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}}]}},{"kind":"Field","name":{"kind":"Name","value":"files"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}}]}},{"kind":"Field","alias":{"kind":"Name","value":"backdropImages"},"name":{"kind":"Name","value":"images"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"type"},"value":{"kind":"EnumValue","value":"BACKDROP"}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"ImageWithAmbientFields"}}]}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Series"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"tagline"}},{"kind":"Field","name":{"kind":"Name","value":"summary"}},{"kind":"Field","name":{"kind":"Name","value":"createdOn"}},{"kind":"Field","name":{"kind":"Name","value":"genres"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}}]}},{"kind":"Field","alias":{"kind":"Name","value":"backdropImages"},"name":{"kind":"Name","value":"images"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"type"},"value":{"kind":"EnumValue","value":"BACKDROP"}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"ImageWithAmbientFields"}}]}}]}}]}}]}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"OrderedEdgeFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"OrderedEdge"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"cursor"}},{"kind":"Field","name":{"kind":"Name","value":"orderKey"}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"ImageWithAmbientFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Image"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"aspectRatio"}},{"kind":"Field","name":{"kind":"Name","value":"blurHash"}},{"kind":"Field","name":{"kind":"Name","value":"ambientColors"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"topLeft"}},{"kind":"Field","name":{"kind":"Name","value":"topRight"}},{"kind":"Field","name":{"kind":"Name","value":"bottomRight"}},{"kind":"Field","name":{"kind":"Name","value":"bottomLeft"}},{"kind":"Field","name":{"kind":"Name","value":"primary"}},{"kind":"Field","name":{"kind":"Name","value":"theme"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"base"}},{"kind":"Field","name":{"kind":"Name","value":"panel"}},{"kind":"Field","name":{"kind":"Name","value":"selected"}},{"kind":"Field","name":{"kind":"Name","value":"accent"}},{"kind":"Field","name":{"kind":"Name","value":"onAccent"}},{"kind":"Field","name":{"kind":"Name","value":"textPrimary"}},{"kind":"Field","name":{"kind":"Name","value":"textSecondary"}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"variants"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"size"}},{"kind":"Field","name":{"kind":"Name","value":"width"}},{"kind":"Field","name":{"kind":"Name","value":"height"}},{"kind":"Field","name":{"kind":"Name","value":"url"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"ContinueWatchingItemFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"ContinueWatchingMedia"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Movie"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"tagline"}},{"kind":"Field","name":{"kind":"Name","value":"summary"}},{"kind":"Field","name":{"kind":"Name","value":"runtime"}},{"kind":"Field","name":{"kind":"Name","value":"createdOn"}},{"kind":"Field","name":{"kind":"Name","value":"genres"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}}]}},{"kind":"Field","name":{"kind":"Name","value":"images"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"type"},"value":{"kind":"EnumValue","value":"BACKDROP"}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"ImageWithAmbientFields"}}]}},{"kind":"Field","name":{"kind":"Name","value":"selectedProfileState"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"watchState"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"watchProgress"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"positionSeconds"}},{"kind":"Field","name":{"kind":"Name","value":"percentComplete"}},{"kind":"Field","name":{"kind":"Name","value":"durationSeconds"}}]}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"files"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Episode"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"episodeNumber"}},{"kind":"Field","name":{"kind":"Name","value":"overview"}},{"kind":"Field","name":{"kind":"Name","value":"runtime"}},{"kind":"Field","name":{"kind":"Name","value":"images"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"type"},"value":{"kind":"EnumValue","value":"STILL"}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"aspectRatio"}},{"kind":"Field","name":{"kind":"Name","value":"blurHash"}},{"kind":"Field","name":{"kind":"Name","value":"variants"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"size"}},{"kind":"Field","name":{"kind":"Name","value":"width"}},{"kind":"Field","name":{"kind":"Name","value":"height"}},{"kind":"Field","name":{"kind":"Name","value":"url"}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"selectedProfileState"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"watchState"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"watchProgress"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"positionSeconds"}},{"kind":"Field","name":{"kind":"Name","value":"percentComplete"}},{"kind":"Field","name":{"kind":"Name","value":"durationSeconds"}}]}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"files"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}}]}},{"kind":"Field","name":{"kind":"Name","value":"season"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"seasonNumber"}},{"kind":"Field","name":{"kind":"Name","value":"series"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"tagline"}},{"kind":"Field","name":{"kind":"Name","value":"summary"}},{"kind":"Field","name":{"kind":"Name","value":"createdOn"}},{"kind":"Field","name":{"kind":"Name","value":"genres"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}}]}},{"kind":"Field","name":{"kind":"Name","value":"seasons"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}}]}},{"kind":"Field","name":{"kind":"Name","value":"images"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"type"},"value":{"kind":"EnumValue","value":"BACKDROP"}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"ImageWithAmbientFields"}}]}}]}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"ContinueWatchingEdgeFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"ContinueWatchingEdge"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"OrderedEdgeFields"}},{"kind":"Field","name":{"kind":"Name","value":"node"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"ContinueWatchingItemFields"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"MediaSummaryFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Media"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Movie"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"titleSort"}},{"kind":"Field","name":{"kind":"Name","value":"releaseDate"}},{"kind":"Field","name":{"kind":"Name","value":"runtime"}},{"kind":"Field","name":{"kind":"Name","value":"selectedProfileState"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"watchState"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"watchStatus"}},{"kind":"Field","name":{"kind":"Name","value":"lastWatchedAt"}},{"kind":"Field","name":{"kind":"Name","value":"watchProgress"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"percentComplete"}}]}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"images"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"type"},"value":{"kind":"EnumValue","value":"POSTER"}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"aspectRatio"}},{"kind":"Field","name":{"kind":"Name","value":"blurHash"}},{"kind":"Field","name":{"kind":"Name","value":"variants"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"size"}},{"kind":"Field","name":{"kind":"Name","value":"width"}},{"kind":"Field","name":{"kind":"Name","value":"height"}},{"kind":"Field","name":{"kind":"Name","value":"url"}}]}}]}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Series"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"titleSort"}},{"kind":"Field","name":{"kind":"Name","value":"firstAirDate"}},{"kind":"Field","name":{"kind":"Name","value":"seasons"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}}]}},{"kind":"Field","name":{"kind":"Name","value":"selectedProfileState"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"watchState"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"watchStatus"}},{"kind":"Field","name":{"kind":"Name","value":"lastWatchedAt"}},{"kind":"Field","name":{"kind":"Name","value":"watchProgress"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"percentComplete"}}]}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"images"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"type"},"value":{"kind":"EnumValue","value":"POSTER"}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"aspectRatio"}},{"kind":"Field","name":{"kind":"Name","value":"blurHash"}},{"kind":"Field","name":{"kind":"Name","value":"variants"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"size"}},{"kind":"Field","name":{"kind":"Name","value":"width"}},{"kind":"Field","name":{"kind":"Name","value":"height"}},{"kind":"Field","name":{"kind":"Name","value":"url"}}]}}]}}]}}]}}]} as unknown as DocumentNode<HomeQuery, HomeQueryVariables>;
export const LanguageSettingsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"LanguageSettings"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"me"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"languagePreferences"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"ProfileLanguagePreferencesFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"ProfileLanguagePreferencesFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"ProfileLanguagePreferences"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"audioLanguages"}},{"kind":"Field","name":{"kind":"Name","value":"subtitleLanguage"}},{"kind":"Field","name":{"kind":"Name","value":"subtitleMode"}}]}}]} as unknown as DocumentNode<LanguageSettingsQuery, LanguageSettingsQueryVariables>;
export const SetLanguagePreferencesDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"SetLanguagePreferences"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"SetLanguagePreferencesInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"setLanguagePreferences"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"languagePreferences"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"ProfileLanguagePreferencesFields"}}]}},{"kind":"Field","name":{"kind":"Name","value":"userErrors"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"MutationError"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"message"}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"InputMutationError"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"inputPath"}}]}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"ProfileLanguagePreferencesFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"ProfileLanguagePreferences"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"audioLanguages"}},{"kind":"Field","name":{"kind":"Name","value":"subtitleLanguage"}},{"kind":"Field","name":{"kind":"Name","value":"subtitleMode"}}]}}]} as unknown as DocumentNode<SetLanguagePreferencesMutation, SetLanguagePreferencesMutationVariables>;
export const LanguageTabsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"LanguageTabs"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"movie"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Boolean"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"series"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Boolean"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"season"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Boolean"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"movie"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}],"directives":[{"kind":"Directive","name":{"kind":"Name","value":"include"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"if"},"value":{"kind":"Variable","name":{"kind":"Name","value":"movie"}}}]}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"selectedProfileState"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"languagePreference"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"LanguagePreferenceFields"}}]}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"series"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}],"directives":[{"kind":"Directive","name":{"kind":"Name","value":"include"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"if"},"value":{"kind":"Variable","name":{"kind":"Name","value":"series"}}}]}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"selectedProfileState"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"languagePreference"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"LanguagePreferenceFields"}}]}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"season"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}],"directives":[{"kind":"Directive","name":{"kind":"Name","value":"include"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"if"},"value":{"kind":"Variable","name":{"kind":"Name","value":"season"}}}]}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"selectedProfileState"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"languagePreference"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"LanguagePreferenceFields"}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"series"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"selectedProfileState"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"languagePreference"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"LanguagePreferenceFields"}}]}}]}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"me"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"languagePreferences"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"ProfileLanguagePreferencesFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"LanguagePreferenceFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"LanguagePreference"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"audioLanguages"}},{"kind":"Field","name":{"kind":"Name","value":"subtitleLanguage"}},{"kind":"Field","name":{"kind":"Name","value":"subtitleMode"}},{"kind":"Field","name":{"kind":"Name","value":"audioSource"}},{"kind":"Field","name":{"kind":"Name","value":"subtitleSource"}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"ProfileLanguagePreferencesFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"ProfileLanguagePreferences"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"audioLanguages"}},{"kind":"Field","name":{"kind":"Name","value":"subtitleLanguage"}},{"kind":"Field","name":{"kind":"Name","value":"subtitleMode"}}]}}]} as unknown as DocumentNode<LanguageTabsQuery, LanguageTabsQueryVariables>;
export const SetLanguageOverrideDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"SetLanguageOverride"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"SetLanguageOverrideInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"setLanguageOverride"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"item"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Movie"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"selectedProfileState"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"languagePreference"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"LanguagePreferenceFields"}}]}}]}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Series"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"selectedProfileState"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"languagePreference"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"LanguagePreferenceFields"}}]}}]}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Season"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"selectedProfileState"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"languagePreference"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"LanguagePreferenceFields"}}]}}]}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Episode"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"selectedProfileState"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"languagePreference"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"LanguagePreferenceFields"}}]}}]}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"userErrors"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"MutationError"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"message"}}]}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"LanguagePreferenceFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"LanguagePreference"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"audioLanguages"}},{"kind":"Field","name":{"kind":"Name","value":"subtitleLanguage"}},{"kind":"Field","name":{"kind":"Name","value":"subtitleMode"}},{"kind":"Field","name":{"kind":"Name","value":"audioSource"}},{"kind":"Field","name":{"kind":"Name","value":"subtitleSource"}}]}}]} as unknown as DocumentNode<SetLanguageOverrideMutation, SetLanguageOverrideMutationVariables>;
export const LibraryItemAddedDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"subscription","name":{"kind":"Name","value":"LibraryItemAdded"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"libraryId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"sort"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"MediaSort"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"filter"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"MediaFilter"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","alias":{"kind":"Name","value":"change"},"name":{"kind":"Name","value":"libraryItemAdded"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"libraryId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"libraryId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"LibraryItemChangeFields"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"MediaSummaryFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Media"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Movie"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"titleSort"}},{"kind":"Field","name":{"kind":"Name","value":"releaseDate"}},{"kind":"Field","name":{"kind":"Name","value":"runtime"}},{"kind":"Field","name":{"kind":"Name","value":"selectedProfileState"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"watchState"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"watchStatus"}},{"kind":"Field","name":{"kind":"Name","value":"lastWatchedAt"}},{"kind":"Field","name":{"kind":"Name","value":"watchProgress"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"percentComplete"}}]}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"images"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"type"},"value":{"kind":"EnumValue","value":"POSTER"}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"aspectRatio"}},{"kind":"Field","name":{"kind":"Name","value":"blurHash"}},{"kind":"Field","name":{"kind":"Name","value":"variants"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"size"}},{"kind":"Field","name":{"kind":"Name","value":"width"}},{"kind":"Field","name":{"kind":"Name","value":"height"}},{"kind":"Field","name":{"kind":"Name","value":"url"}}]}}]}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Series"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"titleSort"}},{"kind":"Field","name":{"kind":"Name","value":"firstAirDate"}},{"kind":"Field","name":{"kind":"Name","value":"seasons"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}}]}},{"kind":"Field","name":{"kind":"Name","value":"selectedProfileState"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"watchState"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"watchStatus"}},{"kind":"Field","name":{"kind":"Name","value":"lastWatchedAt"}},{"kind":"Field","name":{"kind":"Name","value":"watchProgress"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"percentComplete"}}]}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"images"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"type"},"value":{"kind":"EnumValue","value":"POSTER"}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"aspectRatio"}},{"kind":"Field","name":{"kind":"Name","value":"blurHash"}},{"kind":"Field","name":{"kind":"Name","value":"variants"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"size"}},{"kind":"Field","name":{"kind":"Name","value":"width"}},{"kind":"Field","name":{"kind":"Name","value":"height"}},{"kind":"Field","name":{"kind":"Name","value":"url"}}]}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"OrderedEdgeFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"OrderedEdge"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"cursor"}},{"kind":"Field","name":{"kind":"Name","value":"orderKey"}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"LibraryItemChangeFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"LibraryItemChange"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"libraryId"}},{"kind":"Field","name":{"kind":"Name","value":"itemId"}},{"kind":"Field","name":{"kind":"Name","value":"kind"}},{"kind":"Field","name":{"kind":"Name","value":"item"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"MediaSummaryFields"}}]}},{"kind":"Field","name":{"kind":"Name","value":"edge"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"sort"},"value":{"kind":"Variable","name":{"kind":"Name","value":"sort"}}},{"kind":"Argument","name":{"kind":"Name","value":"filter"},"value":{"kind":"Variable","name":{"kind":"Name","value":"filter"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"OrderedEdgeFields"}},{"kind":"Field","name":{"kind":"Name","value":"node"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"MediaSummaryFields"}}]}}]}}]}}]} as unknown as DocumentNode<LibraryItemAddedSubscription, LibraryItemAddedSubscriptionVariables>;
export const LibraryItemUpdatedDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"subscription","name":{"kind":"Name","value":"LibraryItemUpdated"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"libraryId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"sort"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"MediaSort"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"filter"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"MediaFilter"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","alias":{"kind":"Name","value":"change"},"name":{"kind":"Name","value":"libraryItemUpdated"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"libraryId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"libraryId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"LibraryItemChangeFields"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"MediaSummaryFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Media"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Movie"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"titleSort"}},{"kind":"Field","name":{"kind":"Name","value":"releaseDate"}},{"kind":"Field","name":{"kind":"Name","value":"runtime"}},{"kind":"Field","name":{"kind":"Name","value":"selectedProfileState"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"watchState"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"watchStatus"}},{"kind":"Field","name":{"kind":"Name","value":"lastWatchedAt"}},{"kind":"Field","name":{"kind":"Name","value":"watchProgress"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"percentComplete"}}]}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"images"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"type"},"value":{"kind":"EnumValue","value":"POSTER"}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"aspectRatio"}},{"kind":"Field","name":{"kind":"Name","value":"blurHash"}},{"kind":"Field","name":{"kind":"Name","value":"variants"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"size"}},{"kind":"Field","name":{"kind":"Name","value":"width"}},{"kind":"Field","name":{"kind":"Name","value":"height"}},{"kind":"Field","name":{"kind":"Name","value":"url"}}]}}]}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Series"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"titleSort"}},{"kind":"Field","name":{"kind":"Name","value":"firstAirDate"}},{"kind":"Field","name":{"kind":"Name","value":"seasons"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}}]}},{"kind":"Field","name":{"kind":"Name","value":"selectedProfileState"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"watchState"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"watchStatus"}},{"kind":"Field","name":{"kind":"Name","value":"lastWatchedAt"}},{"kind":"Field","name":{"kind":"Name","value":"watchProgress"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"percentComplete"}}]}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"images"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"type"},"value":{"kind":"EnumValue","value":"POSTER"}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"aspectRatio"}},{"kind":"Field","name":{"kind":"Name","value":"blurHash"}},{"kind":"Field","name":{"kind":"Name","value":"variants"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"size"}},{"kind":"Field","name":{"kind":"Name","value":"width"}},{"kind":"Field","name":{"kind":"Name","value":"height"}},{"kind":"Field","name":{"kind":"Name","value":"url"}}]}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"OrderedEdgeFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"OrderedEdge"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"cursor"}},{"kind":"Field","name":{"kind":"Name","value":"orderKey"}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"LibraryItemChangeFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"LibraryItemChange"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"libraryId"}},{"kind":"Field","name":{"kind":"Name","value":"itemId"}},{"kind":"Field","name":{"kind":"Name","value":"kind"}},{"kind":"Field","name":{"kind":"Name","value":"item"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"MediaSummaryFields"}}]}},{"kind":"Field","name":{"kind":"Name","value":"edge"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"sort"},"value":{"kind":"Variable","name":{"kind":"Name","value":"sort"}}},{"kind":"Argument","name":{"kind":"Name","value":"filter"},"value":{"kind":"Variable","name":{"kind":"Name","value":"filter"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"OrderedEdgeFields"}},{"kind":"Field","name":{"kind":"Name","value":"node"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"MediaSummaryFields"}}]}}]}}]}}]} as unknown as DocumentNode<LibraryItemUpdatedSubscription, LibraryItemUpdatedSubscriptionVariables>;
export const LibraryItemRemovedDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"subscription","name":{"kind":"Name","value":"LibraryItemRemoved"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"libraryId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","alias":{"kind":"Name","value":"change"},"name":{"kind":"Name","value":"libraryItemRemoved"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"libraryId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"libraryId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"libraryId"}},{"kind":"Field","name":{"kind":"Name","value":"itemId"}},{"kind":"Field","name":{"kind":"Name","value":"kind"}}]}}]}}]} as unknown as DocumentNode<LibraryItemRemovedSubscription, LibraryItemRemovedSubscriptionVariables>;
export const LibraryCountsChangedDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"subscription","name":{"kind":"Name","value":"LibraryCountsChanged"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"libraryId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","alias":{"kind":"Name","value":"change"},"name":{"kind":"Name","value":"libraryCountsChanged"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"libraryId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"libraryId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"itemCount"}},{"kind":"Field","name":{"kind":"Name","value":"alphabetIndex"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"letter"}},{"kind":"Field","name":{"kind":"Name","value":"count"}}]}}]}}]}}]} as unknown as DocumentNode<LibraryCountsChangedSubscription, LibraryCountsChangedSubscriptionVariables>;
export const LibraryPageDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"LibraryPage"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"libraryId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"first"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"after"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"last"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"before"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"sort"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"MediaSort"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"filter"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"MediaFilter"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"library"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"libraryId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"itemCount"}},{"kind":"Field","name":{"kind":"Name","value":"alphabetIndex"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"letter"}},{"kind":"Field","name":{"kind":"Name","value":"count"}}]}},{"kind":"Field","name":{"kind":"Name","value":"items"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"first"},"value":{"kind":"Variable","name":{"kind":"Name","value":"first"}}},{"kind":"Argument","name":{"kind":"Name","value":"after"},"value":{"kind":"Variable","name":{"kind":"Name","value":"after"}}},{"kind":"Argument","name":{"kind":"Name","value":"last"},"value":{"kind":"Variable","name":{"kind":"Name","value":"last"}}},{"kind":"Argument","name":{"kind":"Name","value":"before"},"value":{"kind":"Variable","name":{"kind":"Name","value":"before"}}},{"kind":"Argument","name":{"kind":"Name","value":"sort"},"value":{"kind":"Variable","name":{"kind":"Name","value":"sort"}}},{"kind":"Argument","name":{"kind":"Name","value":"filter"},"value":{"kind":"Variable","name":{"kind":"Name","value":"filter"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"edges"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"OrderedEdgeFields"}},{"kind":"Field","name":{"kind":"Name","value":"node"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"MediaSummaryFields"}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"pageInfo"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"hasNextPage"}},{"kind":"Field","name":{"kind":"Name","value":"hasPreviousPage"}},{"kind":"Field","name":{"kind":"Name","value":"startCursor"}},{"kind":"Field","name":{"kind":"Name","value":"endCursor"}}]}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"OrderedEdgeFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"OrderedEdge"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"cursor"}},{"kind":"Field","name":{"kind":"Name","value":"orderKey"}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"MediaSummaryFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Media"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Movie"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"titleSort"}},{"kind":"Field","name":{"kind":"Name","value":"releaseDate"}},{"kind":"Field","name":{"kind":"Name","value":"runtime"}},{"kind":"Field","name":{"kind":"Name","value":"selectedProfileState"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"watchState"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"watchStatus"}},{"kind":"Field","name":{"kind":"Name","value":"lastWatchedAt"}},{"kind":"Field","name":{"kind":"Name","value":"watchProgress"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"percentComplete"}}]}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"images"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"type"},"value":{"kind":"EnumValue","value":"POSTER"}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"aspectRatio"}},{"kind":"Field","name":{"kind":"Name","value":"blurHash"}},{"kind":"Field","name":{"kind":"Name","value":"variants"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"size"}},{"kind":"Field","name":{"kind":"Name","value":"width"}},{"kind":"Field","name":{"kind":"Name","value":"height"}},{"kind":"Field","name":{"kind":"Name","value":"url"}}]}}]}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Series"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"titleSort"}},{"kind":"Field","name":{"kind":"Name","value":"firstAirDate"}},{"kind":"Field","name":{"kind":"Name","value":"seasons"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}}]}},{"kind":"Field","name":{"kind":"Name","value":"selectedProfileState"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"watchState"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"watchStatus"}},{"kind":"Field","name":{"kind":"Name","value":"lastWatchedAt"}},{"kind":"Field","name":{"kind":"Name","value":"watchProgress"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"percentComplete"}}]}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"images"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"type"},"value":{"kind":"EnumValue","value":"POSTER"}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"aspectRatio"}},{"kind":"Field","name":{"kind":"Name","value":"blurHash"}},{"kind":"Field","name":{"kind":"Name","value":"variants"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"size"}},{"kind":"Field","name":{"kind":"Name","value":"width"}},{"kind":"Field","name":{"kind":"Name","value":"height"}},{"kind":"Field","name":{"kind":"Name","value":"url"}}]}}]}}]}}]}}]} as unknown as DocumentNode<LibraryPageQuery, LibraryPageQueryVariables>;
export const MarkUnwatchedDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"MarkUnwatched"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"MarkUnwatchedInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"markUnwatched"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"item"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"WatchStateItemFields"}}]}},{"kind":"Field","name":{"kind":"Name","value":"userErrors"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"MutationError"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"message"}}]}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"WatchProgressFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"WatchProgress"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"positionSeconds"}},{"kind":"Field","name":{"kind":"Name","value":"percentComplete"}},{"kind":"Field","name":{"kind":"Name","value":"durationSeconds"}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"WatchStateFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"WatchState"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"watchStatus"}},{"kind":"Field","name":{"kind":"Name","value":"watchProgress"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"WatchProgressFields"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"MovieWatchState"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Movie"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"selectedProfileState"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"watchState"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"WatchStateFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"EpisodeWatchState"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Episode"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"selectedProfileState"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"watchState"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"WatchStateFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"SeasonWatchState"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Season"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"selectedProfileState"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"watchState"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"WatchStateFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"SeriesWatchState"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Series"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"selectedProfileState"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"watchState"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"WatchStateFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"WatchStateItemFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"WatchStateItem"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Movie"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"MovieWatchState"}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Episode"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"EpisodeWatchState"}},{"kind":"Field","name":{"kind":"Name","value":"season"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SeasonWatchState"}},{"kind":"Field","name":{"kind":"Name","value":"series"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SeriesWatchState"}}]}}]}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Season"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SeasonWatchState"}},{"kind":"Field","name":{"kind":"Name","value":"episodes"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"EpisodeWatchState"}}]}},{"kind":"Field","name":{"kind":"Name","value":"series"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SeriesWatchState"}}]}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Series"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SeriesWatchState"}},{"kind":"Field","name":{"kind":"Name","value":"seasons"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SeasonWatchState"}},{"kind":"Field","name":{"kind":"Name","value":"episodes"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"EpisodeWatchState"}}]}}]}}]}}]}}]} as unknown as DocumentNode<MarkUnwatchedMutation, MarkUnwatchedMutationVariables>;
export const MarkWatchedDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"MarkWatched"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"MarkWatchedInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"markWatched"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"item"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"WatchStateItemFields"}}]}},{"kind":"Field","name":{"kind":"Name","value":"userErrors"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"MutationError"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"message"}}]}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"WatchProgressFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"WatchProgress"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"positionSeconds"}},{"kind":"Field","name":{"kind":"Name","value":"percentComplete"}},{"kind":"Field","name":{"kind":"Name","value":"durationSeconds"}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"WatchStateFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"WatchState"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"watchStatus"}},{"kind":"Field","name":{"kind":"Name","value":"watchProgress"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"WatchProgressFields"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"MovieWatchState"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Movie"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"selectedProfileState"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"watchState"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"WatchStateFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"EpisodeWatchState"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Episode"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"selectedProfileState"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"watchState"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"WatchStateFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"SeasonWatchState"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Season"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"selectedProfileState"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"watchState"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"WatchStateFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"SeriesWatchState"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Series"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"selectedProfileState"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"watchState"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"WatchStateFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"WatchStateItemFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"WatchStateItem"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Movie"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"MovieWatchState"}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Episode"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"EpisodeWatchState"}},{"kind":"Field","name":{"kind":"Name","value":"season"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SeasonWatchState"}},{"kind":"Field","name":{"kind":"Name","value":"series"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SeriesWatchState"}}]}}]}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Season"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SeasonWatchState"}},{"kind":"Field","name":{"kind":"Name","value":"episodes"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"EpisodeWatchState"}}]}},{"kind":"Field","name":{"kind":"Name","value":"series"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SeriesWatchState"}}]}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Series"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SeriesWatchState"}},{"kind":"Field","name":{"kind":"Name","value":"seasons"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SeasonWatchState"}},{"kind":"Field","name":{"kind":"Name","value":"episodes"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"EpisodeWatchState"}}]}}]}}]}}]}}]} as unknown as DocumentNode<MarkWatchedMutation, MarkWatchedMutationVariables>;
export const WatchStateChangedDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"subscription","name":{"kind":"Name","value":"WatchStateChanged"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"watchStateChanged"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"continueWatching"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"itemId"}},{"kind":"Field","name":{"kind":"Name","value":"edge"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"ContinueWatchingEdgeFields"}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"items"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Movie"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"MovieWatchState"}},{"kind":"Field","name":{"kind":"Name","value":"selectedProfileState"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"watchState"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"lastWatchedAt"}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"unmatched"}},{"kind":"Field","name":{"kind":"Name","value":"library"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Episode"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"EpisodeWatchState"}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Season"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SeasonWatchState"}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Series"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SeriesWatchState"}},{"kind":"Field","name":{"kind":"Name","value":"selectedProfileState"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"watchState"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"lastWatchedAt"}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"unmatched"}},{"kind":"Field","name":{"kind":"Name","value":"library"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"OrderedEdgeFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"OrderedEdge"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"cursor"}},{"kind":"Field","name":{"kind":"Name","value":"orderKey"}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"ImageWithAmbientFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Image"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"aspectRatio"}},{"kind":"Field","name":{"kind":"Name","value":"blurHash"}},{"kind":"Field","name":{"kind":"Name","value":"ambientColors"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"topLeft"}},{"kind":"Field","name":{"kind":"Name","value":"topRight"}},{"kind":"Field","name":{"kind":"Name","value":"bottomRight"}},{"kind":"Field","name":{"kind":"Name","value":"bottomLeft"}},{"kind":"Field","name":{"kind":"Name","value":"primary"}},{"kind":"Field","name":{"kind":"Name","value":"theme"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"base"}},{"kind":"Field","name":{"kind":"Name","value":"panel"}},{"kind":"Field","name":{"kind":"Name","value":"selected"}},{"kind":"Field","name":{"kind":"Name","value":"accent"}},{"kind":"Field","name":{"kind":"Name","value":"onAccent"}},{"kind":"Field","name":{"kind":"Name","value":"textPrimary"}},{"kind":"Field","name":{"kind":"Name","value":"textSecondary"}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"variants"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"size"}},{"kind":"Field","name":{"kind":"Name","value":"width"}},{"kind":"Field","name":{"kind":"Name","value":"height"}},{"kind":"Field","name":{"kind":"Name","value":"url"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"ContinueWatchingItemFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"ContinueWatchingMedia"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Movie"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"tagline"}},{"kind":"Field","name":{"kind":"Name","value":"summary"}},{"kind":"Field","name":{"kind":"Name","value":"runtime"}},{"kind":"Field","name":{"kind":"Name","value":"createdOn"}},{"kind":"Field","name":{"kind":"Name","value":"genres"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}}]}},{"kind":"Field","name":{"kind":"Name","value":"images"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"type"},"value":{"kind":"EnumValue","value":"BACKDROP"}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"ImageWithAmbientFields"}}]}},{"kind":"Field","name":{"kind":"Name","value":"selectedProfileState"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"watchState"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"watchProgress"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"positionSeconds"}},{"kind":"Field","name":{"kind":"Name","value":"percentComplete"}},{"kind":"Field","name":{"kind":"Name","value":"durationSeconds"}}]}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"files"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Episode"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"episodeNumber"}},{"kind":"Field","name":{"kind":"Name","value":"overview"}},{"kind":"Field","name":{"kind":"Name","value":"runtime"}},{"kind":"Field","name":{"kind":"Name","value":"images"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"type"},"value":{"kind":"EnumValue","value":"STILL"}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"aspectRatio"}},{"kind":"Field","name":{"kind":"Name","value":"blurHash"}},{"kind":"Field","name":{"kind":"Name","value":"variants"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"size"}},{"kind":"Field","name":{"kind":"Name","value":"width"}},{"kind":"Field","name":{"kind":"Name","value":"height"}},{"kind":"Field","name":{"kind":"Name","value":"url"}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"selectedProfileState"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"watchState"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"watchProgress"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"positionSeconds"}},{"kind":"Field","name":{"kind":"Name","value":"percentComplete"}},{"kind":"Field","name":{"kind":"Name","value":"durationSeconds"}}]}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"files"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}}]}},{"kind":"Field","name":{"kind":"Name","value":"season"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"seasonNumber"}},{"kind":"Field","name":{"kind":"Name","value":"series"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"tagline"}},{"kind":"Field","name":{"kind":"Name","value":"summary"}},{"kind":"Field","name":{"kind":"Name","value":"createdOn"}},{"kind":"Field","name":{"kind":"Name","value":"genres"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}}]}},{"kind":"Field","name":{"kind":"Name","value":"seasons"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}}]}},{"kind":"Field","name":{"kind":"Name","value":"images"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"type"},"value":{"kind":"EnumValue","value":"BACKDROP"}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"ImageWithAmbientFields"}}]}}]}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"WatchProgressFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"WatchProgress"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"positionSeconds"}},{"kind":"Field","name":{"kind":"Name","value":"percentComplete"}},{"kind":"Field","name":{"kind":"Name","value":"durationSeconds"}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"WatchStateFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"WatchState"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"watchStatus"}},{"kind":"Field","name":{"kind":"Name","value":"watchProgress"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"WatchProgressFields"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"ContinueWatchingEdgeFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"ContinueWatchingEdge"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"OrderedEdgeFields"}},{"kind":"Field","name":{"kind":"Name","value":"node"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"ContinueWatchingItemFields"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"MovieWatchState"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Movie"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"selectedProfileState"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"watchState"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"WatchStateFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"EpisodeWatchState"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Episode"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"selectedProfileState"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"watchState"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"WatchStateFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"SeasonWatchState"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Season"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"selectedProfileState"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"watchState"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"WatchStateFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"SeriesWatchState"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Series"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"selectedProfileState"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"watchState"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"WatchStateFields"}}]}}]}}]}}]} as unknown as DocumentNode<WatchStateChangedSubscription, WatchStateChangedSubscriptionVariables>;
export const MovieDetailDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"MovieDetail"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"movie"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"tagline"}},{"kind":"Field","name":{"kind":"Name","value":"summary"}},{"kind":"Field","name":{"kind":"Name","value":"runtime"}},{"kind":"Field","name":{"kind":"Name","value":"releaseDate"}},{"kind":"Field","name":{"kind":"Name","value":"contentRating"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"value"}}]}},{"kind":"Field","name":{"kind":"Name","value":"genres"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}}]}},{"kind":"Field","name":{"kind":"Name","value":"directors"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}}]}},{"kind":"Field","name":{"kind":"Name","value":"cast"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"images"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"type"},"value":{"kind":"EnumValue","value":"PROFILE"}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"aspectRatio"}},{"kind":"Field","name":{"kind":"Name","value":"blurHash"}},{"kind":"Field","name":{"kind":"Name","value":"variants"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"size"}},{"kind":"Field","name":{"kind":"Name","value":"width"}},{"kind":"Field","name":{"kind":"Name","value":"height"}},{"kind":"Field","name":{"kind":"Name","value":"url"}}]}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"ratings"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"source"}},{"kind":"Field","name":{"kind":"Name","value":"value"}}]}},{"kind":"Field","name":{"kind":"Name","value":"files"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}}]}},{"kind":"Field","name":{"kind":"Name","value":"selectedProfileState"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"watchState"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"watchStatus"}},{"kind":"Field","name":{"kind":"Name","value":"watchProgress"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"positionSeconds"}},{"kind":"Field","name":{"kind":"Name","value":"percentComplete"}},{"kind":"Field","name":{"kind":"Name","value":"durationSeconds"}}]}}]}}]}},{"kind":"Field","alias":{"kind":"Name","value":"backdropImages"},"name":{"kind":"Name","value":"images"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"type"},"value":{"kind":"EnumValue","value":"BACKDROP"}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"ImageWithAmbientFields"}}]}},{"kind":"Field","alias":{"kind":"Name","value":"posterImages"},"name":{"kind":"Name","value":"images"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"type"},"value":{"kind":"EnumValue","value":"POSTER"}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"ImageWithAmbientFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"ImageWithAmbientFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Image"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"aspectRatio"}},{"kind":"Field","name":{"kind":"Name","value":"blurHash"}},{"kind":"Field","name":{"kind":"Name","value":"ambientColors"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"topLeft"}},{"kind":"Field","name":{"kind":"Name","value":"topRight"}},{"kind":"Field","name":{"kind":"Name","value":"bottomRight"}},{"kind":"Field","name":{"kind":"Name","value":"bottomLeft"}},{"kind":"Field","name":{"kind":"Name","value":"primary"}},{"kind":"Field","name":{"kind":"Name","value":"theme"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"base"}},{"kind":"Field","name":{"kind":"Name","value":"panel"}},{"kind":"Field","name":{"kind":"Name","value":"selected"}},{"kind":"Field","name":{"kind":"Name","value":"accent"}},{"kind":"Field","name":{"kind":"Name","value":"onAccent"}},{"kind":"Field","name":{"kind":"Name","value":"textPrimary"}},{"kind":"Field","name":{"kind":"Name","value":"textSecondary"}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"variants"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"size"}},{"kind":"Field","name":{"kind":"Name","value":"width"}},{"kind":"Field","name":{"kind":"Name","value":"height"}},{"kind":"Field","name":{"kind":"Name","value":"url"}}]}}]}}]} as unknown as DocumentNode<MovieDetailQuery, MovieDetailQueryVariables>;
export const NotificationsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"Notifications"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"first"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"after"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"notifications"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"first"},"value":{"kind":"Variable","name":{"kind":"Name","value":"first"}}},{"kind":"Argument","name":{"kind":"Name","value":"after"},"value":{"kind":"Variable","name":{"kind":"Name","value":"after"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"edges"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"NotificationEdgeFields"}}]}},{"kind":"Field","name":{"kind":"Name","value":"pageInfo"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"hasNextPage"}},{"kind":"Field","name":{"kind":"Name","value":"endCursor"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"OrderedEdgeFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"OrderedEdge"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"cursor"}},{"kind":"Field","name":{"kind":"Name","value":"orderKey"}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"NotificationFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Notification"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"message"}},{"kind":"Field","name":{"kind":"Name","value":"latestEventAt"}},{"kind":"Field","name":{"kind":"Name","value":"unread"}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"RequestNotification"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"expiresAt"}},{"kind":"Field","name":{"kind":"Name","value":"resolution"}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"ProfileShareOfferedNotification"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"answer"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"NotificationEdgeFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"NotificationEdge"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"OrderedEdgeFields"}},{"kind":"Field","name":{"kind":"Name","value":"node"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"NotificationFields"}}]}}]}}]} as unknown as DocumentNode<NotificationsQuery, NotificationsQueryVariables>;
export const MarkNotificationsReadDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"MarkNotificationsRead"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"MarkNotificationsReadInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"markNotificationsRead"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"unreadNotificationCount"}},{"kind":"Field","name":{"kind":"Name","value":"userErrors"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"MutationError"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"message"}}]}}]}}]}}]}}]} as unknown as DocumentNode<MarkNotificationsReadMutation, MarkNotificationsReadMutationVariables>;
export const NotificationsChangedDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"subscription","name":{"kind":"Name","value":"NotificationsChanged"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"notificationsChanged"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"notifications"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"notificationId"}},{"kind":"Field","name":{"kind":"Name","value":"edge"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"NotificationEdgeFields"}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"unreadNotificationCount"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"OrderedEdgeFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"OrderedEdge"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"cursor"}},{"kind":"Field","name":{"kind":"Name","value":"orderKey"}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"NotificationFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Notification"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"message"}},{"kind":"Field","name":{"kind":"Name","value":"latestEventAt"}},{"kind":"Field","name":{"kind":"Name","value":"unread"}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"RequestNotification"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"expiresAt"}},{"kind":"Field","name":{"kind":"Name","value":"resolution"}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"ProfileShareOfferedNotification"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"answer"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"NotificationEdgeFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"NotificationEdge"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"OrderedEdgeFields"}},{"kind":"Field","name":{"kind":"Name","value":"node"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"NotificationFields"}}]}}]}}]} as unknown as DocumentNode<NotificationsChangedSubscription, NotificationsChangedSubscriptionVariables>;
export const UnreadNotificationCountDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"UnreadNotificationCount"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"unreadNotificationCount"}}]}}]} as unknown as DocumentNode<UnreadNotificationCountQuery, UnreadNotificationCountQueryVariables>;
export const SeasonDetailDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"SeasonDetail"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"season"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"seasonNumber"}},{"kind":"Field","name":{"kind":"Name","value":"overview"}},{"kind":"Field","name":{"kind":"Name","value":"airDate"}},{"kind":"Field","name":{"kind":"Name","value":"selectedProfileState"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"watchState"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"watchStatus"}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"series"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"contentRating"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"value"}}]}},{"kind":"Field","name":{"kind":"Name","value":"directors"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}}]}},{"kind":"Field","name":{"kind":"Name","value":"seasons"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"seasonNumber"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"selectedProfileState"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"watchState"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"watchStatus"}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"episodes"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"selectedProfileState"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"watchState"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"watchStatus"}}]}}]}}]}}]}},{"kind":"Field","alias":{"kind":"Name","value":"backdropImages"},"name":{"kind":"Name","value":"images"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"type"},"value":{"kind":"EnumValue","value":"BACKDROP"}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"ImageWithAmbientFields"}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"episodes"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"episodeNumber"}},{"kind":"Field","name":{"kind":"Name","value":"runtime"}},{"kind":"Field","name":{"kind":"Name","value":"selectedProfileState"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"watchState"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"watchStatus"}},{"kind":"Field","name":{"kind":"Name","value":"watchProgress"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"positionSeconds"}},{"kind":"Field","name":{"kind":"Name","value":"percentComplete"}},{"kind":"Field","name":{"kind":"Name","value":"durationSeconds"}}]}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"files"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}}]}},{"kind":"Field","alias":{"kind":"Name","value":"stillImages"},"name":{"kind":"Name","value":"images"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"type"},"value":{"kind":"EnumValue","value":"STILL"}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"aspectRatio"}},{"kind":"Field","name":{"kind":"Name","value":"blurHash"}},{"kind":"Field","name":{"kind":"Name","value":"variants"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"size"}},{"kind":"Field","name":{"kind":"Name","value":"width"}},{"kind":"Field","name":{"kind":"Name","value":"height"}},{"kind":"Field","name":{"kind":"Name","value":"url"}}]}}]}}]}},{"kind":"Field","alias":{"kind":"Name","value":"backdropImages"},"name":{"kind":"Name","value":"images"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"type"},"value":{"kind":"EnumValue","value":"BACKDROP"}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"ImageWithAmbientFields"}}]}},{"kind":"Field","alias":{"kind":"Name","value":"posterImages"},"name":{"kind":"Name","value":"images"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"type"},"value":{"kind":"EnumValue","value":"POSTER"}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"ImageWithAmbientFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"ImageWithAmbientFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Image"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"aspectRatio"}},{"kind":"Field","name":{"kind":"Name","value":"blurHash"}},{"kind":"Field","name":{"kind":"Name","value":"ambientColors"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"topLeft"}},{"kind":"Field","name":{"kind":"Name","value":"topRight"}},{"kind":"Field","name":{"kind":"Name","value":"bottomRight"}},{"kind":"Field","name":{"kind":"Name","value":"bottomLeft"}},{"kind":"Field","name":{"kind":"Name","value":"primary"}},{"kind":"Field","name":{"kind":"Name","value":"theme"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"base"}},{"kind":"Field","name":{"kind":"Name","value":"panel"}},{"kind":"Field","name":{"kind":"Name","value":"selected"}},{"kind":"Field","name":{"kind":"Name","value":"accent"}},{"kind":"Field","name":{"kind":"Name","value":"onAccent"}},{"kind":"Field","name":{"kind":"Name","value":"textPrimary"}},{"kind":"Field","name":{"kind":"Name","value":"textSecondary"}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"variants"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"size"}},{"kind":"Field","name":{"kind":"Name","value":"width"}},{"kind":"Field","name":{"kind":"Name","value":"height"}},{"kind":"Field","name":{"kind":"Name","value":"url"}}]}}]}}]} as unknown as DocumentNode<SeasonDetailQuery, SeasonDetailQueryVariables>;
export const SeriesDetailDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"SeriesDetail"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"series"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"tagline"}},{"kind":"Field","name":{"kind":"Name","value":"summary"}},{"kind":"Field","name":{"kind":"Name","value":"firstAirDate"}},{"kind":"Field","name":{"kind":"Name","value":"contentRating"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"value"}}]}},{"kind":"Field","name":{"kind":"Name","value":"genres"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}}]}},{"kind":"Field","name":{"kind":"Name","value":"directors"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}}]}},{"kind":"Field","name":{"kind":"Name","value":"cast"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"images"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"type"},"value":{"kind":"EnumValue","value":"PROFILE"}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"aspectRatio"}},{"kind":"Field","name":{"kind":"Name","value":"blurHash"}},{"kind":"Field","name":{"kind":"Name","value":"variants"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"size"}},{"kind":"Field","name":{"kind":"Name","value":"width"}},{"kind":"Field","name":{"kind":"Name","value":"height"}},{"kind":"Field","name":{"kind":"Name","value":"url"}}]}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"selectedProfileState"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"watchState"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"watchStatus"}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"seasons"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"seasonNumber"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"airDate"}},{"kind":"Field","name":{"kind":"Name","value":"selectedProfileState"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"watchState"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"watchStatus"}},{"kind":"Field","name":{"kind":"Name","value":"watchProgress"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"percentComplete"}}]}}]}}]}},{"kind":"Field","alias":{"kind":"Name","value":"posterImages"},"name":{"kind":"Name","value":"images"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"type"},"value":{"kind":"EnumValue","value":"POSTER"}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"aspectRatio"}},{"kind":"Field","name":{"kind":"Name","value":"blurHash"}},{"kind":"Field","name":{"kind":"Name","value":"variants"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"size"}},{"kind":"Field","name":{"kind":"Name","value":"width"}},{"kind":"Field","name":{"kind":"Name","value":"height"}},{"kind":"Field","name":{"kind":"Name","value":"url"}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"episodes"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"episodeNumber"}},{"kind":"Field","name":{"kind":"Name","value":"selectedProfileState"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"watchState"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"watchStatus"}},{"kind":"Field","name":{"kind":"Name","value":"watchProgress"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"positionSeconds"}},{"kind":"Field","name":{"kind":"Name","value":"durationSeconds"}}]}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"files"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]}},{"kind":"Field","alias":{"kind":"Name","value":"backdropImages"},"name":{"kind":"Name","value":"images"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"type"},"value":{"kind":"EnumValue","value":"BACKDROP"}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"ImageWithAmbientFields"}}]}},{"kind":"Field","alias":{"kind":"Name","value":"posterImages"},"name":{"kind":"Name","value":"images"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"type"},"value":{"kind":"EnumValue","value":"POSTER"}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"ImageWithAmbientFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"ImageWithAmbientFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Image"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"aspectRatio"}},{"kind":"Field","name":{"kind":"Name","value":"blurHash"}},{"kind":"Field","name":{"kind":"Name","value":"ambientColors"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"topLeft"}},{"kind":"Field","name":{"kind":"Name","value":"topRight"}},{"kind":"Field","name":{"kind":"Name","value":"bottomRight"}},{"kind":"Field","name":{"kind":"Name","value":"bottomLeft"}},{"kind":"Field","name":{"kind":"Name","value":"primary"}},{"kind":"Field","name":{"kind":"Name","value":"theme"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"base"}},{"kind":"Field","name":{"kind":"Name","value":"panel"}},{"kind":"Field","name":{"kind":"Name","value":"selected"}},{"kind":"Field","name":{"kind":"Name","value":"accent"}},{"kind":"Field","name":{"kind":"Name","value":"onAccent"}},{"kind":"Field","name":{"kind":"Name","value":"textPrimary"}},{"kind":"Field","name":{"kind":"Name","value":"textSecondary"}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"variants"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"size"}},{"kind":"Field","name":{"kind":"Name","value":"width"}},{"kind":"Field","name":{"kind":"Name","value":"height"}},{"kind":"Field","name":{"kind":"Name","value":"url"}}]}}]}}]} as unknown as DocumentNode<SeriesDetailQuery, SeriesDetailQueryVariables>;
export const CreatePlaybackSessionDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreatePlaybackSession"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"CreatePlaybackSessionInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createPlaybackSession"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"playbackSession"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"PlaybackSessionFields"}}]}},{"kind":"Field","name":{"kind":"Name","value":"userErrors"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"MutationError"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"message"}}]}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"PlaybackSessionFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"PlaybackSession"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"formatAttemptCount"}},{"kind":"Field","name":{"kind":"Name","value":"maximumFormatAttempts"}},{"kind":"Field","name":{"kind":"Name","value":"requestedChoice"}},{"kind":"Field","name":{"kind":"Name","value":"playbackChoice"}},{"kind":"Field","name":{"kind":"Name","value":"formatChange"}},{"kind":"Field","name":{"kind":"Name","value":"offeredChoices"}},{"kind":"Field","name":{"kind":"Name","value":"currentFormatAttempt"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"PendingPlaybackFormatAttempt"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"streamSessionId"}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"ReadyPlaybackFormatAttempt"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"streamSession"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"streamUrl"}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"HlsStreamSession"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"transcodeMode"}},{"kind":"Field","name":{"kind":"Name","value":"videoRange"}},{"kind":"Field","name":{"kind":"Name","value":"mediaEndSeconds"}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"DirectPlayStreamSession"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"sourceContainer"}},{"kind":"Field","name":{"kind":"Name","value":"videoRange"}},{"kind":"Field","name":{"kind":"Name","value":"startPositionSeconds"}},{"kind":"Field","name":{"kind":"Name","value":"audioTrackPosition"}},{"kind":"Field","name":{"kind":"Name","value":"audioTracks"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"position"}},{"kind":"Field","name":{"kind":"Name","value":"language"}},{"kind":"Field","name":{"kind":"Name","value":"title"}}]}}]}}]}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"FailedPlaybackFormatAttempt"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"streamSessionId"}},{"kind":"Field","name":{"kind":"Name","value":"error"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"MutationError"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"message"}}]}}]}}]}}]}}]}}]} as unknown as DocumentNode<CreatePlaybackSessionMutation, CreatePlaybackSessionMutationVariables>;
export const DestroyPlaybackSessionDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DestroyPlaybackSession"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"DestroyPlaybackSessionInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"destroyPlaybackSession"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"playbackSessionId"}},{"kind":"Field","name":{"kind":"Name","value":"userErrors"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"MutationError"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"message"}}]}}]}}]}}]}}]} as unknown as DocumentNode<DestroyPlaybackSessionMutation, DestroyPlaybackSessionMutationVariables>;
export const PlaybackDecisionsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"PlaybackDecisions"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"playbackSession"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"decisions"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"PlaybackDecisionFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"VideoFormatFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"VideoFormat"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"codec"}},{"kind":"Field","name":{"kind":"Name","value":"width"}},{"kind":"Field","name":{"kind":"Name","value":"height"}},{"kind":"Field","name":{"kind":"Name","value":"frameRate"}},{"kind":"Field","name":{"kind":"Name","value":"bitrate"}},{"kind":"Field","name":{"kind":"Name","value":"videoRange"}},{"kind":"Field","name":{"kind":"Name","value":"dolbyVision"}},{"kind":"Field","name":{"kind":"Name","value":"details"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"codecProfile"}},{"kind":"Field","name":{"kind":"Name","value":"codecLevel"}},{"kind":"Field","name":{"kind":"Name","value":"bitDepth"}},{"kind":"Field","name":{"kind":"Name","value":"chromaSubsampling"}},{"kind":"Field","name":{"kind":"Name","value":"compatibleBase"}},{"kind":"Field","name":{"kind":"Name","value":"hdr10Plus"}},{"kind":"Field","name":{"kind":"Name","value":"dolbyVision"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"presence"}},{"kind":"Field","name":{"kind":"Name","value":"profile"}},{"kind":"Field","name":{"kind":"Name","value":"level"}},{"kind":"Field","name":{"kind":"Name","value":"baseLayerCompatibilityId"}},{"kind":"Field","name":{"kind":"Name","value":"enhancementLayer"}},{"kind":"Field","name":{"kind":"Name","value":"observedRpu"}}]}},{"kind":"Field","name":{"kind":"Name","value":"masteringDisplay"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"minLuminance"}},{"kind":"Field","name":{"kind":"Name","value":"maxLuminance"}}]}},{"kind":"Field","name":{"kind":"Name","value":"contentLightLevel"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"maxContentLightLevel"}},{"kind":"Field","name":{"kind":"Name","value":"maxFrameAverageLightLevel"}}]}},{"kind":"Field","name":{"kind":"Name","value":"bitstreamRewrites"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"AudioFormatFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"AudioFormat"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"codec"}},{"kind":"Field","name":{"kind":"Name","value":"channels"}},{"kind":"Field","name":{"kind":"Name","value":"bitrate"}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"PlaybackDecisionFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"PlaybackDecision"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"formatAttempt"}},{"kind":"Field","name":{"kind":"Name","value":"streamSessionId"}},{"kind":"Field","name":{"kind":"Name","value":"video"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"delivery"}},{"kind":"Field","name":{"kind":"Name","value":"source"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"VideoFormatFields"}}]}},{"kind":"Field","name":{"kind":"Name","value":"output"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"VideoFormatFields"}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"audio"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"delivery"}},{"kind":"Field","name":{"kind":"Name","value":"source"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"AudioFormatFields"}}]}},{"kind":"Field","name":{"kind":"Name","value":"output"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"AudioFormatFields"}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"reasons"}}]}}]} as unknown as DocumentNode<PlaybackDecisionsQuery, PlaybackDecisionsQueryVariables>;
export const PlaybackSessionDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"PlaybackSession"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"playbackSession"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"PlaybackSessionFields"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"PlaybackSessionFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"PlaybackSession"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"formatAttemptCount"}},{"kind":"Field","name":{"kind":"Name","value":"maximumFormatAttempts"}},{"kind":"Field","name":{"kind":"Name","value":"requestedChoice"}},{"kind":"Field","name":{"kind":"Name","value":"playbackChoice"}},{"kind":"Field","name":{"kind":"Name","value":"formatChange"}},{"kind":"Field","name":{"kind":"Name","value":"offeredChoices"}},{"kind":"Field","name":{"kind":"Name","value":"currentFormatAttempt"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"PendingPlaybackFormatAttempt"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"streamSessionId"}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"ReadyPlaybackFormatAttempt"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"streamSession"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"streamUrl"}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"HlsStreamSession"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"transcodeMode"}},{"kind":"Field","name":{"kind":"Name","value":"videoRange"}},{"kind":"Field","name":{"kind":"Name","value":"mediaEndSeconds"}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"DirectPlayStreamSession"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"sourceContainer"}},{"kind":"Field","name":{"kind":"Name","value":"videoRange"}},{"kind":"Field","name":{"kind":"Name","value":"startPositionSeconds"}},{"kind":"Field","name":{"kind":"Name","value":"audioTrackPosition"}},{"kind":"Field","name":{"kind":"Name","value":"audioTracks"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"position"}},{"kind":"Field","name":{"kind":"Name","value":"language"}},{"kind":"Field","name":{"kind":"Name","value":"title"}}]}}]}}]}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"FailedPlaybackFormatAttempt"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"streamSessionId"}},{"kind":"Field","name":{"kind":"Name","value":"error"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"MutationError"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"message"}}]}}]}}]}}]}}]}}]} as unknown as DocumentNode<PlaybackSessionQuery, PlaybackSessionQueryVariables>;
export const PlayerSubtitleModesDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"PlayerSubtitleModes"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"movie"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Boolean"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"movie"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}],"directives":[{"kind":"Directive","name":{"kind":"Name","value":"include"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"if"},"value":{"kind":"Variable","name":{"kind":"Name","value":"movie"}}}]}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"selectedProfileState"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"languagePreference"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"LanguagePreferenceFields"}}]}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"episode"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}],"directives":[{"kind":"Directive","name":{"kind":"Name","value":"skip"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"if"},"value":{"kind":"Variable","name":{"kind":"Name","value":"movie"}}}]}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"selectedProfileState"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"languagePreference"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"LanguagePreferenceFields"}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"season"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"selectedProfileState"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"languagePreference"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"LanguagePreferenceFields"}}]}}]}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"me"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"languagePreferences"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"ProfileLanguagePreferencesFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"LanguagePreferenceFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"LanguagePreference"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"audioLanguages"}},{"kind":"Field","name":{"kind":"Name","value":"subtitleLanguage"}},{"kind":"Field","name":{"kind":"Name","value":"subtitleMode"}},{"kind":"Field","name":{"kind":"Name","value":"audioSource"}},{"kind":"Field","name":{"kind":"Name","value":"subtitleSource"}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"ProfileLanguagePreferencesFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"ProfileLanguagePreferences"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"audioLanguages"}},{"kind":"Field","name":{"kind":"Name","value":"subtitleLanguage"}},{"kind":"Field","name":{"kind":"Name","value":"subtitleMode"}}]}}]} as unknown as DocumentNode<PlayerSubtitleModesQuery, PlayerSubtitleModesQueryVariables>;
export const PlayerMediaTitleDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"PlayerMediaTitle"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"movie"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Boolean"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"movie"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}],"directives":[{"kind":"Directive","name":{"kind":"Name","value":"include"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"if"},"value":{"kind":"Variable","name":{"kind":"Name","value":"movie"}}}]}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"title"}}]}},{"kind":"Field","name":{"kind":"Name","value":"episode"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}],"directives":[{"kind":"Directive","name":{"kind":"Name","value":"skip"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"if"},"value":{"kind":"Variable","name":{"kind":"Name","value":"movie"}}}]}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"episodeNumber"}},{"kind":"Field","name":{"kind":"Name","value":"season"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"seasonNumber"}},{"kind":"Field","name":{"kind":"Name","value":"series"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"title"}}]}}]}}]}}]}}]} as unknown as DocumentNode<PlayerMediaTitleQuery, PlayerMediaTitleQueryVariables>;
export const ReportPlaybackFormatFailureDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"ReportPlaybackFormatFailure"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ReportPlaybackFormatFailureInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"reportPlaybackFormatFailure"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"playbackSession"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"PlaybackSessionFields"}}]}},{"kind":"Field","name":{"kind":"Name","value":"userErrors"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"MutationError"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"message"}}]}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"PlaybackSessionFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"PlaybackSession"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"formatAttemptCount"}},{"kind":"Field","name":{"kind":"Name","value":"maximumFormatAttempts"}},{"kind":"Field","name":{"kind":"Name","value":"requestedChoice"}},{"kind":"Field","name":{"kind":"Name","value":"playbackChoice"}},{"kind":"Field","name":{"kind":"Name","value":"formatChange"}},{"kind":"Field","name":{"kind":"Name","value":"offeredChoices"}},{"kind":"Field","name":{"kind":"Name","value":"currentFormatAttempt"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"PendingPlaybackFormatAttempt"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"streamSessionId"}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"ReadyPlaybackFormatAttempt"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"streamSession"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"streamUrl"}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"HlsStreamSession"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"transcodeMode"}},{"kind":"Field","name":{"kind":"Name","value":"videoRange"}},{"kind":"Field","name":{"kind":"Name","value":"mediaEndSeconds"}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"DirectPlayStreamSession"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"sourceContainer"}},{"kind":"Field","name":{"kind":"Name","value":"videoRange"}},{"kind":"Field","name":{"kind":"Name","value":"startPositionSeconds"}},{"kind":"Field","name":{"kind":"Name","value":"audioTrackPosition"}},{"kind":"Field","name":{"kind":"Name","value":"audioTracks"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"position"}},{"kind":"Field","name":{"kind":"Name","value":"language"}},{"kind":"Field","name":{"kind":"Name","value":"title"}}]}}]}}]}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"FailedPlaybackFormatAttempt"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"streamSessionId"}},{"kind":"Field","name":{"kind":"Name","value":"error"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"MutationError"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"message"}}]}}]}}]}}]}}]}}]} as unknown as DocumentNode<ReportPlaybackFormatFailureMutation, ReportPlaybackFormatFailureMutationVariables>;
export const SwitchPlaybackAudioTrackDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"SwitchPlaybackAudioTrack"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"SwitchPlaybackAudioTrackInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"switchPlaybackAudioTrack"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"playbackSession"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"PlaybackSessionFields"}}]}},{"kind":"Field","name":{"kind":"Name","value":"userErrors"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"MutationError"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"message"}}]}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"PlaybackSessionFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"PlaybackSession"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"formatAttemptCount"}},{"kind":"Field","name":{"kind":"Name","value":"maximumFormatAttempts"}},{"kind":"Field","name":{"kind":"Name","value":"requestedChoice"}},{"kind":"Field","name":{"kind":"Name","value":"playbackChoice"}},{"kind":"Field","name":{"kind":"Name","value":"formatChange"}},{"kind":"Field","name":{"kind":"Name","value":"offeredChoices"}},{"kind":"Field","name":{"kind":"Name","value":"currentFormatAttempt"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"PendingPlaybackFormatAttempt"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"streamSessionId"}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"ReadyPlaybackFormatAttempt"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"streamSession"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"streamUrl"}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"HlsStreamSession"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"transcodeMode"}},{"kind":"Field","name":{"kind":"Name","value":"videoRange"}},{"kind":"Field","name":{"kind":"Name","value":"mediaEndSeconds"}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"DirectPlayStreamSession"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"sourceContainer"}},{"kind":"Field","name":{"kind":"Name","value":"videoRange"}},{"kind":"Field","name":{"kind":"Name","value":"startPositionSeconds"}},{"kind":"Field","name":{"kind":"Name","value":"audioTrackPosition"}},{"kind":"Field","name":{"kind":"Name","value":"audioTracks"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"position"}},{"kind":"Field","name":{"kind":"Name","value":"language"}},{"kind":"Field","name":{"kind":"Name","value":"title"}}]}}]}}]}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"FailedPlaybackFormatAttempt"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"streamSessionId"}},{"kind":"Field","name":{"kind":"Name","value":"error"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"MutationError"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"message"}}]}}]}}]}}]}}]}}]} as unknown as DocumentNode<SwitchPlaybackAudioTrackMutation, SwitchPlaybackAudioTrackMutationVariables>;