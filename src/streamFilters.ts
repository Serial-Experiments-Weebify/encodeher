import { BaseProbeStream, VideoProbeStream } from "./ffmpegTypes";

const ASS_CODEC = "ass";
const FONTS = new Set(["otf", "ttf"]);

export function videoStream(streams: BaseProbeStream[]): VideoProbeStream {
    const video = streams.find((stream) => stream.codec_type === "video");

    if (!video) throw "No video streams";

    return video as VideoProbeStream;
}

export function audioStream(
    streams: BaseProbeStream[],
    lang = "jpn"
): BaseProbeStream {
    const audioStreams = streams.filter(
        (stream) => stream.codec_type === "audio"
    );

    if (audioStreams.length == 0) throw "No audio streams";

    const withLang = audioStreams.filter(
        (audioStream) => audioStream.tags["language"] === lang
    );

    const remaining = withLang.length > 0 ? withLang : audioStreams;

    const defaultAudio = remaining.find(
        (stream) => stream.disposition.default != 0
    );

    return defaultAudio ?? remaining[0];
}

interface StreamWithLength extends BaseProbeStream {
    c_stream_len: number;
}

export async function subtitleStream(
    streams: BaseProbeStream[],
    lang: string = "jpn",
    getLen: (index: number) => Promise<number>,
    allowUndefinedLanguage: boolean = true,
    banSignsAndSongs: boolean = true
): Promise<BaseProbeStream | null> {
    const subtitles = streams.filter(
        (stream) =>
            stream.codec_type === "subtitle" && stream.codec_name == ASS_CODEC
    );
    if (subtitles.length == 0) return null;

    // match languages
    const langMatchSubs = subtitles.filter((sub) => sub.tags.language === lang);
    const langUndefinedSubs = subtitles.filter(
        (sub) => sub.tags.language === "und" || sub.tags.language == null
    );
    const langSubs =
        langMatchSubs.length == 0 && allowUndefinedLanguage
            ? langUndefinedSubs
            : langMatchSubs;

    if (langSubs.length == 0) return null;
    if (langSubs.length == 1) return langSubs[0];

    //optionally ban sings & songs; kinda dumb check but it works (sometimes)
    const finalSubs = banSignsAndSongs
        ? langSubs.filter(
              (sub) =>
                  !sub.tags.title?.toLowerCase().includes("signs") &&
                  !sub.tags.title?.toLowerCase().includes("songs")
          )
        : langSubs;

    if (finalSubs.length == 0) return null;
    if (finalSubs.length == 1) return finalSubs[0];

    try {
        const subStreamsWithLengths: StreamWithLength[] = await Promise.all(
            subtitles.map(async (subStream) => ({
                ...subStream,
                c_stream_len: await getLen(subStream.index),
            }))
        );

        const longest = subStreamsWithLengths.reduce((prev, cur) =>
            cur.c_stream_len > prev.c_stream_len ? cur : prev
        );

        return longest;
    } catch (e) {
        console.error("Error getting stream length:");
        console.error(e);
        return null;
    }
}
export function assSubs(streams: BaseProbeStream[]) {
    return streams.filter((x) => x.codec_name == ASS_CODEC);
}

export function allSubs(streams: BaseProbeStream[]) {
    return streams.filter((x) => x.codec_type == "subtitle");
}

export function supportedFonts(streams: BaseProbeStream[]) {
    return streams.filter((x) => FONTS.has(x.codec_name));
}

export function allAudio(streams: BaseProbeStream[]) {
    return streams.filter((stream) => stream.codec_type === "audio");
}

export function uniqueLangAudio(
    streams: BaseProbeStream[],
    defaultStream: BaseProbeStream
) {
    streams = streams.filter((x) => x.codec_type == "audio");
    const langMap = new Map<string, BaseProbeStream>();

    langMap.set(defaultStream.tags.language ?? "???", defaultStream);

    streams.forEach((s) => {
        const lang = s.tags.language ?? "???";
        if (!langMap.get(lang)) {
            langMap.set(lang, s);
        }
    });

    return [...langMap.values()];
}
