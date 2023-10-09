import { Resolution } from './resolution';
import { Chapter } from './videoFile';

export interface Subtitles {
    name: string;
    lang: string;
    default: boolean;
    file: string;
}

export interface Audio {
    lang: string;
    default: boolean;
    file: string;
}

export interface Video {
    resolution: Resolution;
    file: string;
}

export interface WeebifyV1Manifest {
    version: 1;
    subtitles: Subtitles[];
    fontMap: Record<string, string>;
    job: string;
    audio: Audio[];
    videos: Video[];
    chapters: Chapter[];
}
