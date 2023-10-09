import { PackAudio, PackVideo, VideoFile, packMPD } from '../util/videoFile';
import path from 'path';
import fs from 'fs/promises';
import { getResolutions } from '../util/resolution';
import {
    Audio,
    Subtitles,
    WeebifyV1Manifest,
    Video,
} from '../util/weebifyManifest';
import { VideoProbeStream } from '../util/ffmpegTypes';
import * as getDefault from '../util/streamFilters';
import slugify from 'slugify';

import { MultiBar } from 'cli-progress';
import { EncodherLogger } from '../util/logger';
import { PROGRESS_CONF } from '../util/progress';
import { getJobPaths } from '../util/jobPaths';

function padJobName(job: string) {
    return job.padStart(20, ' ');
}

let activeLogger: EncodherLogger | null = null;

function handleGlobalError(e: any) {
    if (!activeLogger) return;

    activeLogger.writeHeader('Global Error');
    activeLogger.append(e.toString() + '\n');
    activeLogger.close('uncaught exception/rejection');

    console.error('FATAL:');
    console.error(e);
    process.exit(1);
}

export async function pack(
    inputPath: string,
    fid: string,
    dir: string | undefined = undefined,
) {
    await fs.access(inputPath);

    const { basedir, fontdir, outdir } = getJobPaths(fid, dir);

    await fs.rm(basedir, { force: true, recursive: true }).catch(() => 0);
    await fs.mkdir(basedir, { recursive: true });
    await fs.mkdir(fontdir);
    await fs.mkdir(outdir);

    const bars = new MultiBar(...PROGRESS_CONF);

    const logger = (activeLogger = new EncodherLogger(basedir));
    process.on('uncaughtException', handleGlobalError);
    process.on('unhandledRejection', handleGlobalError);

    const video = await VideoFile.at(inputPath, logger);

    // get streams - DONE
    logger.writeHeader('Gathering metadata');
    const metaBar = bars.create(3, 0, {
        job: padJobName('Gathering metadata'),
        status: 'Main probe',
    });

    const { streams, format } = await video.getStreamsAndFormat();

    const videoStream = streams.find(
        (x) => x.codec_type == 'video',
    ) as VideoProbeStream;

    // get facts - DONE
    const resolutions = getResolutions(videoStream.width, videoStream.height);
    metaBar.update(1, { status: 'Steam selection' });
    const vs = getDefault.videoStream(streams);
    const as = getDefault.audioStream(streams, 'jpn');
    const ss = await getDefault.subtitleStream(streams, 'eng', (i) =>
        video.getSubTextSize(i),
    );
    // all audio streams
    const audioStreams = getDefault.uniqueLangAudio(streams, as);

    metaBar.update(2, { status: 'Chapters' });
    const chapters = await video.getChapters();
    metaBar.update(3);
    logger.writeFooter();

    logger.writeHeader('Dumping subs and fonts');
    // extract subs, fonts
    const subStreams = getDefault.assSubs(streams);
    const subtitles: Subtitles[] = [];
    const subBar = bars.create(subStreams.length, 0, {
        job: padJobName('Extracting subs'),
        status: '',
    });

    const fontAttachments = getDefault.supportedFonts(streams);
    const fontMap: Record<string, string> = {};
    const fontBar = bars.create(fontAttachments.length, 0, {
        job: padJobName('Extracting fonts'),
        status: '',
    });

    const total_time = parseFloat(format.duration);

    const v0bar = bars.create(total_time, 0, {
        job: padJobName('Encoding V0'),
        status: '',
    });
    const v1bars = resolutions.map((x) =>
        bars.create(total_time, 0, {
            job: padJobName(`Encoding V1 ${x.name}`),
            status: '',
        }),
    );
    const audioBars = audioStreams.map((x) =>
        bars.create(total_time, 0, {
            job: padJobName(`Audio ${x.tags.language ?? 'unk'}`),
            status: '',
        }),
    );

    let i = 0;
    for (const subStream of subStreams) {
        const newName =
            subStream.tags.title ??
            `Subtitles #${subStream.index} (${
                subStream.tags.language ?? '???'
            })`;
        const subFileName = slugify(newName) + '.ass';
        const subPath = path.join(outdir, subFileName);

        subBar.update(i, { status: subFileName });
        await video.extractStream(subStream.index, 'ass', subPath);
        subBar.update(++i, { status: subFileName });

        subtitles.push({
            name: newName,
            file: subFileName,
            lang: subStream.tags.language ?? '???',
            default: subStream.index == ss?.index,
        });
    }

    i = 0;
    for (const font of fontAttachments) {
        if (!font.tags.filename) throw 'Attachment lacking filename';

        fontBar.update(i, { status: font.tags.filename });
        const outName = await video.dumpAttachmentWithHash(
            font.index,
            fontdir,
            font.tags.filename,
        );
        fontBar.update(++i, { status: font.tags.filename });

        fontMap[font.tags.filename] = outName;
    }

    logger.writeFooter();

    const fallbackRes =
        resolutions.find((x) => x.name == '720p') ??
        resolutions.find((x) => x.name == 'native') ??
        resolutions[0];

    // subtitle filter doesnt work like 0:x but 0:s:x (subtitle only index)
    const subIndex = !ss
        ? null
        : getDefault
              .allSubs(streams) //get all subs
              .findIndex((x) => x.index == ss?.index); //find subtitle index of our subs

    await video.encodeV0(
        vs.index,
        as.index,
        subIndex,
        fallbackRes,
        outdir,
        (t) => {
            v0bar.update(t);
        },
    );
    v0bar.update(total_time);

    logger.writeHeader('Encoding videos');

    const dashVideos: PackVideo[] = [];
    const videos: Video[] = [];
    i = 0;
    for (const res of resolutions) {
        const videoFilePath = await video.encodeVideo(vs, res, basedir, (t) => {
            v1bars[i].update(t);
        });
        v1bars[i].update(total_time);

        dashVideos.push({ path: videoFilePath, res });
        videos.push({
            file: path.basename(videoFilePath),
            resolution: res,
        });

        i++;
    }

    logger.writeFooter();
    logger.writeHeader('Encoding audio');

    const audio: Audio[] = [];
    const dashAudio: PackAudio[] = [];
    i = 0;
    for (const audioStream of audioStreams) {
        const audioFilePath = await video.encodeAudio(
            audioStream,
            basedir,
            (t) => {
                audioBars[i].update(t);
            },
        );
        audioBars[i].update(total_time);

        dashAudio.push({
            path: audioFilePath,
            default: audioStream.index == as.index,
            lang: audioStream.tags.language ?? 'unk',
        });

        audio.push({
            file: path.basename(audioFilePath),
            lang: audioStream.tags.language ?? 'unk',
            default: audioStream.index == as.index,
        });

        i++;
    }

    logger.writeFooter();
    bars.stop();

    console.log('Writing dash manifest');

    await packMPD(dashVideos, dashAudio, outdir, logger);

    const manifest: WeebifyV1Manifest = {
        version: 1,
        chapters,
        videos,
        audio,
        fontMap,
        subtitles,
        job: fid,
    };

    console.log('Writing weebify manifest');
    logger.append(`Writing weebify manifest\n`);

    await fs.writeFile(
        path.join(outdir, 'weebify.json'),
        JSON.stringify(manifest),
    );

    logger.close('Done!');
    console.log('K THX BYE');
}
