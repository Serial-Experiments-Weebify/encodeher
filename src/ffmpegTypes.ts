export type HashAlgorithm =
    | "MD5"
    | "murmur3"
    | "RIPEMD128"
    | "RIPEMD160"
    | "RIPEMD256"
    | "RIPEMD320"
    | "SHA160"
    | "SHA224"
    | "SHA256"
    | "SHA512/224"
    | "SHA512/256"
    | "SHA384"
    | "SHA512"
    | "CRC32"
    | "adler32.";

export type StreamType = "video" | "audio" | "subtitle" | "attachment";

export interface StreamDisposition {
    default: 0 | 1;
    dub: 0 | 1;
    original: 0 | 1;
    comment: 0 | 1;
    lyrics: 0 | 1;
    karaoke: 0 | 1;
    forced: 0 | 1;
    hearing_impaired: 0 | 1;
    visual_impaired: 0 | 1;
    clean_effects: 0 | 1;
    attached_pic: 0 | 1;
    timed_thumbnails: 0 | 1;
    captions: 0 | 1;
    descriptions: 0 | 1;
    metadata: 0 | 1;
    dependent: 0 | 1;
    still_image: 0 | 1;
}

export interface ShowFormat {
    format: {
        filename: string;
        nb_streams: number;
        nb_programs: number;
        format_name: string;
        format_long_name: string;
        start_time: string;
        duration: string;
        size: string;
        bit_rate: string;
        probe_score: number;
        tags: {
            [index: string]: string;
        };
    };
}

export interface BaseProbeStream {
    index: number;
    codec_name: string;
    codec_long_name: string;
    codec_tag_string: string;
    codec_tag: string;
    codec_type: StreamType;
    duration: string;
    duration_ts: number;
    time_base: string;
    start_time: string;
    start_pts: number;
    tags: Record<string, string>;
    extradata: string;
    disposition: StreamDisposition;
}

export interface VideoProbeStream extends BaseProbeStream {
    stream_type: "video";
    width: number;
    height: number;
}

export interface ShowStreams {
    streams: BaseProbeStream[];
}

export type ProbeResult = ShowFormat & ShowStreams;
