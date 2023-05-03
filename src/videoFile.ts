import { spawn, exec, ChildProcessWithoutNullStreams } from "child_process";
import { access } from "fs/promises";
import { createWriteStream } from "fs";
import fs from "fs/promises";
import * as FF from "./ffmpegTypes";
import path, { join } from "path";
import { createHash } from "crypto";
import { Resolution } from "./resolution";

interface IProbeSpawnResult {
    code: number;
    stdout: string;
    stderr: string;
}

function getStdioAsString(
    name: string,
    args: string[],
    collect_error: boolean = true
): Promise<IProbeSpawnResult> {
    return new Promise((resolve, reject) => {
        const child = spawn(name, args);
        const stdout: string[] = [],
            stderr: string[] = [];

        child.stdout.on("data", (data) => stdout.push(data.toString()));
        if (collect_error)
            child.stderr.on("data", (data) => stderr.push(data.toString()));

        child.on("exit", (code) =>
            resolve({
                code: code ?? 0,
                stdout: stdout.join(""),
                stderr: stderr.join(""),
            })
        );
    });
}

function ffEscape(text: string) {
    return `'${text.replace(/\'/g, "'\\''")}'`;
}

function ffmpegGetStreamProcess(file: string, index: number, format: string) {
    return spawn("ffmpeg", [
        "-i",
        file,
        "-map",
        `0:${index}`,
        "-f",
        format,
        "-",
    ]);
}

function ffmpegGetStreamLength(
    file: string,
    index: number,
    format: string
): Promise<number> {
    const p = ffmpegGetStreamProcess(file, index, format);
    let l = 0;
    return new Promise((resolve, reject) => {
        p.stdout.on("data", (chunk) => {
            l += chunk.length;
        });
        p.on("exit", (code) => {
            if (code == 0) resolve(l);
            else reject("Process exited with code: " + code);
        });
    });
}

function waitForExit(process: ChildProcessWithoutNullStreams): Promise<void> {
    return new Promise((resolve, reject) => {
        process.on("exit", (code) => {
            if (code == 0) resolve();
            else reject("Process exited with code: " + code);
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
    outDir: string
) {
    const packagerArgs = [];

    videoFiles.forEach((x) => {
        const vfName = x.res.name + ".webm";
        const outPath = path.join(outDir, vfName);
        packagerArgs.push(`in=${x.path},stream=video,output=${outPath}`);
    });

    audioFiles.forEach((x) => {
        const afName = x.lang + ".webm";
        const outPath = path.join(outDir, afName);

        packagerArgs.push(
            `in=${x.path},stream=audio,lang=${x.lang}${
                x.default ? ",roles=main" : ""
            },output=${outPath}`
        );
    });

    packagerArgs.push("--mpd_output", path.join(outDir, "manifest.mpd"));

    console.log(`command: \npackager ${packagerArgs.join("\n")}`);
    const packager = spawn("packager", packagerArgs);

    console.log("Redirecting output...\n\n");
    packager.stderr.pipe(process.stderr);

    await waitForExit(packager);
    return true;
}

export class VideoFile {
    private constructor(protected filePath: string) {}

    public static async at(filePath: string) {
        await access(filePath);
        return new VideoFile(filePath);
    }

    public async getStreamsAndFormat(): Promise<FF.ProbeResult> {
        const result = await getStdioAsString("ffprobe", [
            "-v",
            "quiet",
            "-print_format",
            "json",
            "-show_format",
            "-show_streams",
            this.filePath,
        ]);
        return JSON.parse(result.stdout);
    }

    public async getSubTextSize(index: number) {
        return ffmpegGetStreamLength(this.filePath, index, "srt");
    }

    public async getStreamHashes(
        algo: FF.HashAlgorithm,
        indexes: number[]
    ): Promise<Record<number, string>> {
        const streamMappings = indexes.map((i) => ["-map", `0:${i}`]).flat();
        console.log(streamMappings);
        const result = await getStdioAsString("ffmpeg", [
            "-v",
            "quiet",
            "-i",
            this.filePath,
            "-f",
            "streamhash",
            "-hash",
            algo,
            "-",
        ]);
        console.log(result.stdout);
        const hashes = result.stdout
            .split("\n")
            .filter((x) => x.length > 0)
            .map((line) => line.split(",")[2].split("=")[1]);
        let out: Record<number, string> = {};

        hashes.forEach((hash, i) => (out[indexes[i]] = hash));

        return out;
    }

    public dumpAttachmentWithHash(
        index: number,
        outPath: string,
        filename: string
    ): Promise<string> {
        return new Promise((resolve, reject) => {
            const outFileName = join(outPath, filename);

            const src = spawn("ffmpeg", [
                "-v",
                "quiet",
                "-y",
                `-dump_attachment:${index}`,
                outFileName,
                "-i",
                this.filePath,
            ]);
            src.on("exit", async (code) => {
                fs.access(outFileName).catch(() => reject("Extraction failed"));

                const hash = await getStdioAsString(
                    "md5sum",
                    ["-b", outFileName],
                    false
                );
                if (hash.code != 0) throw "MD5 failed";
                const md5 = hash.stdout.trim().split(" ")?.[0];
                if (!md5) throw "MD5 failed";

                const newName = `${md5}-${filename}`;
                const newPath = path.join(outPath, newName);

                fs.rename(outFileName, newPath).catch(reject);
                resolve(newName);
            });
        });
    }

    public extractStream(
        index: number,
        format: string,
        outFile: string
    ): Promise<void> {
        return new Promise((resolve, reject) => {
            const proc = spawn("ffmpeg", [
                "-v",
                "quiet",
                "-y",
                "-i",
                this.filePath,
                "-map",
                `0:${index}`,
                "-c",
                "copy",
                "-f",
                format,
                outFile,
            ]);

            proc.on("exit", (code) => {
                if (code == 0) resolve();
                else reject("Process exited with code: " + code);
            });
        });
    }

    async encodeV0(
        videoIndex: number,
        audioIndex: number,
        subtitleIndex: number | null,
        resolution: Resolution,
        outPath: string
    ) {
        const outFile = path.join(outPath, "fallback.mp4");
        //? set yes to overwrite, some stdout settings, input file and faststart
        const baseArgs = [
            "-y",
            "-hide_banner",
            "-loglevel",
            "32",
            // "64",
            "-stats",
            "-i",
            this.filePath,
            "-movflags",
            "+faststart",
            "-brand",
            "mp42",
        ];
        //? point to video stream and select video codec
        const videoArgs = ["-map", `0:${videoIndex}`, "-c:v", "libx264"];
        //? point to audio stream, select audio codec, downmix to 2 channels
        const audioArgs = [
            "-map",
            `0:${audioIndex}`,
            "-c:a",
            "aac",
            "-ac",
            "2",
        ];

        const filters = [
            "format=yuv420p",
            `scale=${resolution.w}:${resolution.h}`,
        ];

        if (subtitleIndex != null)
            filters.push(
                `subtitles=${ffEscape(
                    ffEscape(this.filePath)
                )}:si=${subtitleIndex}`
            );

        const filterArgs = ["-vf", filters.join(",")];

        //? set the output file format, some libx264 settings and output file name
        const encoderArgs = [
            "-f",
            "mp4",
            "-crf",
            "23",
            "-preset",
            "slow",
            "-tune",
            "animation",
            "-bf",
            "2",
            "-g",
            "90",
            outFile,
        ];

        const args = [
            ...baseArgs,
            ...videoArgs,
            ...audioArgs,
            ...filterArgs,
            ...encoderArgs,
        ];

        console.log(`command: \nffmpeg ${args.join(" ")}`);
        const encoderProcess = spawn("ffmpeg", args, {});

        console.log("Redirecting output...\n\n");
        encoderProcess.stderr.pipe(process.stderr);

        await waitForExit(encoderProcess);
    }

    async encodeAudio(audioStream: FF.BaseProbeStream, outPath: string) {
        const baseArgs = [
            "-y", //overwrite
            "-hide_banner",
            "-loglevel",
            "24", // warn/error
            "-stats",
            "-i",
            this.filePath,
            "-vn", //no video
        ];

        const audioArgs = [
            "-map",
            `0:${audioStream.index}`,
            "-c:a",
            "libopus",
            "-b:a",
            "96k",
            "-ar",
            "48000",
            "-ac",
            "2",
        ];

        const outFile = path.join(
            outPath,
            (audioStream.tags.language ?? "unk") + ".webm"
        );

        const args = [...baseArgs, ...audioArgs, outFile];

        console.log(`command: \nffmpeg ${args.join(" ")}`);

        const encoderProcess = spawn("ffmpeg", args, {});

        console.log("Redirecting output...\n\n");
        encoderProcess.stderr.pipe(process.stderr);

        await waitForExit(encoderProcess);
        return outFile;
    }

    async encodeVideo(
        videoStream: FF.BaseProbeStream,
        resolution: Resolution,
        outPath: string
    ) {
        const baseArgs = [
            "-y", //overwrite
            "-hide_banner",
            "-loglevel",
            "24", // warn/error
            "-stats",
            "-i",
            this.filePath,
            "-an", //no audio
        ];

        const filters: string[] = [];

        if (resolution.name != "native") {
            filters.push(`scale=${resolution.w}:${resolution.h}`);
        }

        const filterArgs: string[] = [];

        if (filters.length > 0) filterArgs.push("-vf", filters.join(","));

        const videoArgs = [
            "-map",
            `0:${videoStream.index}`,
            "-c:v",
            "libsvtav1", // AV1 we ball
            "-g", // GOP
            "90",
            "-preset",
            "7", // Presets 4-6 are commonly used by home enthusiasts
            "-crf",
            "33", //Experience has shown that relatively high crf values with low levels of film-grain
            "-svtav1-params",
            "tune=0:film-grain=2", //with low levels of film-grain
            //produce 2D animation results that are visually good
        ];

        const outFile = path.join(outPath, resolution.name + ".webm");
        const args = [...baseArgs, ...filterArgs, ...videoArgs, outFile];

        console.log(`command: \nffmpeg ${args.join(" ")}`);
        const encoderProcess = spawn("ffmpeg", args, {});

        console.log("Redirecting output...\n\n");
        encoderProcess.stderr.pipe(process.stderr);

        await waitForExit(encoderProcess);
        return outFile;
    }
}
