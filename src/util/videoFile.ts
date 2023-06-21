import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import { access } from 'fs/promises';
import fs from 'fs/promises';
import * as FF from './ffmpegTypes';
import path, { join } from 'path';
import { Resolution } from '../util/resolution';
import { EncodherLogger } from './logger';

interface IProbeSpawnResult {
    code: number;
    stdout: string;
    stderr: string;
}

function getStdioAsString(
    name: string,
    args: string[],
    collect_error = true,
    logger: EncodherLogger,
): Promise<IProbeSpawnResult> {
    return new Promise((resolve) => {
        const child = spawn(name, args);
        const stdout: string[] = [],
            stderr: string[] = [];

        child.stdout.on('data', (data) => stdout.push(data.toString()));
        child.stderr.on('data', (data) => logger.append(data.toString()));
        if (collect_error)
            child.stderr.on('data', (data) => stderr.push(data.toString()));

        child.on('exit', (code) =>
            resolve({
                code: code ?? 0,
                stdout: stdout.join(''),
                stderr: stderr.join(''),
            }),
        );
    });
}

function ffEscape(text: string) {
    return `'${text.replace(/\'/g, "'\\''")}'`;
}

function ffmpegGetStreamProcess(file: string, index: number, format: string) {
    return spawn('ffmpeg', [
        '-loglevel',
        '24',
        '-i',
        file,
        '-map',
        `0:${index}`,
        '-f',
        format,
        '-',
    ]);
}

function ffmpegGetStreamLength(
    file: string,
    index: number,
    format: string,
    logger: EncodherLogger,
): Promise<number> {
    const p = ffmpegGetStreamProcess(file, index, format);
    let l = 0;
    return new Promise((resolve, reject) => {
        logger.writeHeader(`Stream #${index} length as ${format}`);
        p.stdout.on('data', (chunk) => (l += chunk.length));

        p.stderr.on('on', (chunk) => logger.append(chunk.toString()));

        p.on('exit', (code) => {
            if (code == 0) resolve(l);
            else reject('Process exited with code: ' + code);
            logger.writeFooter();
        });
    });
}

function waitForExit(process: ChildProcessWithoutNullStreams): Promise<void> {
    return new Promise((resolve, reject) => {
        process.on('exit', (code) => {
            if (code == 0) resolve();
            else reject('Process exited with code: ' + code);
        });
    });
}

export interface PackVideo {
    res: Resolution;
    path: string;
}

export interface PackAudio {
    lang: string;
    path: string;
    default: boolean;
}

export async function packMPD(
    videoFiles: PackVideo[],
    audioFiles: PackAudio[],
    outDir: string,
    logger: EncodherLogger,
) {
    const packagerArgs = [];

    videoFiles.forEach((x) => {
        const vfName = 'v' + x.res.name + '.webm';
        const outPath = path.join(outDir, vfName);
        packagerArgs.push(`in=${x.path},stream=video,output=${outPath}`);
    });

    audioFiles.forEach((x) => {
        const afName = 'a' + x.lang + '.webm';
        const outPath = path.join(outDir, afName);

        packagerArgs.push(
            `in=${x.path},stream=audio,lang=${x.lang}${
                x.default ? ',roles=main' : ''
            },output=${outPath}`,
        );
    });

    packagerArgs.push('--mpd_output', path.join(outDir, 'manifest.mpd'));

    const packager = spawn('packager', packagerArgs);

    logger.writeHeader('Packager output');

    packager.stderr.on('data', (chunk) => logger.append(chunk.toString()));

    await waitForExit(packager);
    logger.writeFooter();
    return true;
}

export interface Chapter {
    start: number;
    title: string;
    end: number;
}

function extractTime(str: string): number | undefined {
    const time = str
        .match(/time=(-?\d+):(\d+):(\d+)\.(\d+)\s/)
        ?.slice(1, 5)
        .reverse()
        .map((x, i) => parseInt(x) * (i == 0 ? 0.01 : 60 ** (i - 1)))
        .reduce((p, c) => c + p);

    if (!time) return undefined;

    return Math.max(0, time);
}

export class VideoFile {
    private constructor(
        protected filePath: string,
        protected logger: EncodherLogger,
    ) {}

    public static async at(filePath: string, logger: EncodherLogger) {
        await access(filePath);
        return new VideoFile(filePath, logger);
    }

    public async getStreamsAndFormat(): Promise<FF.ProbeResult> {
        this.logger.writeHeader('Streams and format');
        const result = await getStdioAsString(
            'ffprobe',
            [
                '-loglevel',
                '24',
                '-print_format',
                'json',
                '-show_format',
                '-show_streams',
                this.filePath,
            ],
            false,
            this.logger,
        );
        this.logger.writeFooter();
        return JSON.parse(result.stdout);
    }

    public async getChapters(): Promise<Chapter[]> {
        this.logger.writeHeader('Chapters');
        const result = await getStdioAsString(
            'ffprobe',
            [
                '-loglevel',
                '24',
                '-print_format',
                'json',
                '-show_chapters',
                this.filePath,
            ],
            false,
            this.logger,
        );
        this.logger.writeFooter();
        const raw = JSON.parse(result.stdout) as FF.ShowChapters;

        return raw.chapters.map((x) => ({
            start: parseFloat(x.start_time),
            end: parseFloat(x.end_time),
            title: x.tags?.title ?? '?',
        }));
    }

    public async getSubTextSize(index: number) {
        return ffmpegGetStreamLength(this.filePath, index, 'srt', this.logger);
    }

    public dumpAttachmentWithHash(
        index: number,
        outPath: string,
        filename: string,
    ): Promise<string> {
        return new Promise((resolve, reject) => {
            const outFileName = join(outPath, filename);
            this.logger.writeHeader(`Dump attachment ${index}`);

            const args = [
                '-loglevel',
                '24',
                '-y',
                `-dump_attachment:${index}`,
                outFileName,
                '-i',
                this.filePath,
            ];

            const src = spawn('ffmpeg', args);

            src.stderr.on('data', (chunk) =>
                this.logger.append(chunk.toString()),
            );

            src.on('exit', async (/*fuck you ffmpeg devs*/) => {
                // I used to check the return code here, but ffmpeg devs decided
                // that I don't deserve a stable API and randomly started
                // returning 1 on success I hope they recieve a pipe bomb in the
                // mail
                fs.access(outFileName).catch(() => reject('Extraction failed'));

                const hash = await getStdioAsString(
                    'md5sum',
                    ['-b', outFileName],
                    false,
                    this.logger,
                );
                if (hash.code != 0) throw 'MD5 failed';
                const md5 = hash.stdout.trim().split(' ')?.[0];
                if (!md5) throw 'MD5 failed';

                const newName = `${md5}-${filename}`;
                const newPath = path.join(outPath, newName);

                this.logger.writeFooter();
                await fs.rename(outFileName, newPath).catch(reject);
                resolve(newName);
            });
        });
    }

    public extractStream(
        index: number,
        format: string,
        outFile: string,
    ): Promise<void> {
        return new Promise((resolve, reject) => {
            this.logger.writeHeader(`Extract stream ${index}`);
            const proc = spawn('ffmpeg', [
                '-loglevel',
                '24',
                '-y',
                '-i',
                this.filePath,
                '-map',
                `0:${index}`,
                '-c',
                'copy',
                '-f',
                format,
                outFile,
            ]);

            proc.stderr.on('data', (chunk) =>
                this.logger.append(chunk.toString()),
            );

            proc.on('exit', (code) => {
                this.logger.writeFooter();
                if (code == 0) resolve();
                else reject('Process exited with code: ' + code);
            });
        });
    }

    async encodeV0(
        videoIndex: number,
        audioIndex: number,
        subtitleIndex: number | null,
        resolution: Resolution,
        outPath: string,
        updateProgress: (progress: number) => void = () => void 0,
    ) {
        const outFile = path.join(outPath, 'fallback.mp4');
        //? set yes to overwrite, some stdout settings, input file and faststart
        const baseArgs = [
            '-y',
            '-hide_banner',
            '-loglevel',
            '24',
            '-stats',
            '-i',
            this.filePath,
            '-movflags',
            '+faststart',
            '-brand',
            'mp42',
        ];
        //? point to video stream and select video codec
        const videoArgs = ['-map', `0:${videoIndex}`, '-c:v', 'libx264'];
        //? point to audio stream, select audio codec, downmix to 2 channels
        const audioArgs = [
            '-map',
            `0:${audioIndex}`,
            '-c:a',
            'aac',
            '-ac',
            '2',
        ];

        const filters = [
            'format=yuv420p',
            `scale=${resolution.w}:${resolution.h}`,
        ];

        if (subtitleIndex != null)
            filters.push(
                `subtitles=${ffEscape(
                    ffEscape(this.filePath),
                )}:si=${subtitleIndex}`,
            );

        const filterArgs = ['-vf', filters.join(',')];

        //? set the output file format, some libx264 settings and output file name
        const encoderArgs = [
            '-f',
            'mp4',
            '-crf',
            '23',
            '-preset',
            'slow',
            '-tune',
            'animation',
            '-bf',
            '2',
            '-g',
            '90',
            outFile,
        ];

        const args = [
            ...baseArgs,
            ...videoArgs,
            ...audioArgs,
            ...filterArgs,
            ...encoderArgs,
        ];

        this.logger.writeHeader('Video V0');
        this.logger.append(`command: \nffmpeg ${args.join(' ')}\n`);
        const encoderProcess = spawn('ffmpeg', args, {});

        encoderProcess.stderr.on('data', (chunk) => {
            const txt = chunk.toString();

            const time = extractTime(txt);
            if (time) updateProgress(time);

            this.logger.append(txt);
        });

        await waitForExit(encoderProcess);
        this.logger.writeFooter();
    }

    async encodeAudio(
        audioStream: FF.BaseProbeStream,
        outPath: string,
        updateProgress: (progress: number) => void = () => void 0,
    ) {
        const baseArgs = [
            '-y', //overwrite
            '-hide_banner',
            '-loglevel',
            '24', // warn/error
            '-stats',
            '-i',
            this.filePath,
            '-vn', //no video
        ];

        const audioArgs = [
            '-map',
            `0:${audioStream.index}`,
            '-c:a',
            'libopus',
            '-b:a',
            '96k',
            '-ar',
            '48000',
            '-ac',
            '2',
        ];

        const audioName = audioStream.tags.language ?? 'unk';
        const outFile = path.join(outPath, 'a' + audioName + '.webm');

        const args = [...baseArgs, ...audioArgs, outFile];

        this.logger.writeHeader(`Audio ${audioName}`);
        this.logger.append(`command: \nffmpeg ${args.join(' ')}\n`);

        const encoderProcess = spawn('ffmpeg', args, {});

        encoderProcess.stderr.on('data', (chunk) => {
            const txt = chunk.toString();

            const time = extractTime(txt);
            if (time) updateProgress(time);

            this.logger.append(txt);
        });

        await waitForExit(encoderProcess);
        this.logger.writeFooter();

        return outFile;
    }

    async encodeVideo(
        videoStream: FF.BaseProbeStream,
        resolution: Resolution,
        outPath: string,
        updateProgress: (progress: number) => void = () => void 0,
    ) {
        const baseArgs = [
            '-y', //overwrite
            '-hide_banner',
            '-loglevel',
            '24', // warn/error
            '-stats',
            '-i',
            this.filePath,
            '-an', //no audio
        ];

        const filters: string[] = [];

        if (resolution.name != 'native') {
            filters.push(`scale=${resolution.w}:${resolution.h}`);
        }

        const filterArgs: string[] = [];

        if (filters.length > 0) filterArgs.push('-vf', filters.join(','));

        const videoArgs = [
            '-map',
            `0:${videoStream.index}`,
            '-c:v',
            'libsvtav1', // AV1 we ball
            '-g', // GOP
            '90',
            '-preset',
            '7', // Presets 4-6 are commonly used by home enthusiasts
            '-crf',
            '33', //Experience has shown that relatively high crf values with low levels of film-grain
            '-svtav1-params',
            'tune=0:film-grain=2', //with low levels of film-grain
            //produce 2D animation results that are visually good
        ];

        const outFile = path.join(outPath, 'v' + resolution.name + '.webm');
        const args = [...baseArgs, ...filterArgs, ...videoArgs, outFile];

        this.logger.writeHeader(`Video ${resolution.name}`);
        this.logger.append(`command: \nffmpeg ${args.join(' ')}\n`);
        const encoderProcess = spawn('ffmpeg', args, {});

        encoderProcess.stderr.on('data', (chunk) => {
            const txt = chunk.toString();

            const time = extractTime(txt);
            if (time) updateProgress(time);

            this.logger.append(txt);
        });

        await waitForExit(encoderProcess);
        this.logger.writeFooter();
        return outFile;
    }
}
