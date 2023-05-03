import { PackAudio, PackVideo, VideoFile, packMPD } from "./videoFile";
import path from "path";
import os from "os";
import fs from "fs/promises";
import { Resolution, getResolutions } from "./resolution";
import { BaseProbeStream, VideoProbeStream } from "./ffmpegTypes";
import * as getDefault from "./streamFilters";
import slugify from "slugify";

const file =
    "/mnt/nanami/media/anime/[Judas] Dr. Stone (Season 1) [1080p][HEVC x265 10bit][Dual-Audio][Multi-Subs]/[Judas] Dr. Stone S1 - 01.mkv";

function getTmpPath() {
    return path.join(os.tmpdir(), "weebify-encodeher");
}

interface Subtitles {
    name: string;
    lang: string;
    default: boolean;
    file: string;
}

interface Audio {
    lang: string;
    default: boolean;
    file: string;
}

interface WeebifyV1Manifest {
    version: 1;
    subtitles: Subtitles[];
    fontMap: Record<string, string>;
    job: string;
    resolutions: Resolution[];
}

async function pack(
    inputPath: string,
    fid: string,
    dir: string | undefined = undefined
) {
    // setup
    console.log("Initalizing");
    const video = await VideoFile.at(inputPath);
    const basedir = path.join(dir ?? getTmpPath(), `${fid}`);
    const fontdir = path.join(basedir, "fonts");
    const outdir = path.join(basedir, "out");

    await fs.rm(basedir, { force: true, recursive: true }).catch(() => 0);
    await fs.mkdir(basedir, { recursive: true });

    await fs.mkdir(fontdir);
    await fs.mkdir(outdir);

    // get streams - DONE
    console.log("Gathering metadata");
    const { streams } = await video.getStreamsAndFormat();

    const videoStream = streams.find(
        (x) => x.codec_type == "video"
    ) as VideoProbeStream;

    // get facts - DONE
    const resolutions = getResolutions(videoStream.width, videoStream.height);
    const vs = getDefault.videoStream(streams);
    const as = getDefault.audioStream(streams, "jpn");
    const ss = await getDefault.subtitleStream(streams, "eng", (i) =>
        video.getSubTextSize(i)
    );

    // extract subs, fonts
    const subStreams = getDefault.assSubs(streams);
    const subtitles: Subtitles[] = [];

    let i = 1;
    for (let subStream of subStreams) {
        console.log(`Extracting subtitles ${i} of ${subStreams.length}`);
        const newName =
            subStream.tags.title ??
            `Subtitles #${subStream.index} (${
                subStream.tags.language ?? "???"
            })`;
        const subFileName = slugify(newName) + ".ass";
        const subPath = path.join(outdir, subFileName);

        await video.extractStream(subStream.index, "ass", subPath);

        subtitles.push({
            name: newName,
            file: subFileName,
            lang: subStream.tags.language ?? "???",
            default: subStream.index == ss?.index,
        });
        i++;
    }

    const fontAttachments = getDefault.supportedFonts(streams);
    const fontMap: Record<string, string> = {};

    i = 1;
    for (let font of fontAttachments) {
        console.log(`Extracting font ${i} of ${fontAttachments.length}`);
        if (!font.tags.filename) throw "Attachment lacking filename";
        const outName = await video.dumpAttachmentWithHash(
            font.index,
            fontdir,
            font.tags.filename
        );

        fontMap[font.tags.filename] = `fonts/${outName}`;
        i++;
    }

    const fallbackRes =
        resolutions.find((x) => x.name == "720p") ??
        resolutions.find((x) => x.name == "native") ??
        resolutions[0];

    // subtitle filter doesnt work like 0:x but 0:s:x (subtitle only index)
    const subIndex = !ss
        ? null
        : getDefault
              .allSubs(streams) //get all subs
              .findIndex((x) => x.index == ss?.index); //find subtitle index of our subs

    await video.encodeV0(vs.index, as.index, subIndex, fallbackRes, outdir);

    const dashVideos: PackVideo[] = [];
    for (let res of resolutions) {
        const path = await video.encodeVideo(vs, res, basedir);
        dashVideos.push({ path, res });
    }

    const dashAudio: PackAudio[] = [];
    const audioStreams = getDefault.uniqueLangAudio(streams, as);
    for (let audioStream of audioStreams) {
        const path = await video.encodeAudio(audioStream, basedir);

        dashAudio.push({
            path,
            default: audioStream.index == as.index,
            lang: audioStream.tags.language ?? "unk",
        });
    }

    await packMPD(dashVideos, dashAudio, outdir);

    const manifest: WeebifyV1Manifest = {
        version: 1,
        resolutions,
        fontMap,
        subtitles,
        job: fid,
    };

    await fs.writeFile(
        path.join(outdir, "weebify.json"),
        JSON.stringify(manifest)
    );
}

async function main() {
    console.group("Encode her??");
    console.group();
    console.group();
    await pack(file, "fuck-my-life");
    console.groupEnd();
    console.groupEnd();
    console.groupEnd();

    console.log("I barely even know her");
}

main();

if (process.env.DEBUG) {
    setTimeout(() => {}, 100000000);
}
