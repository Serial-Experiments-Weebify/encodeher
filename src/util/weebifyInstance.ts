import axios, { AxiosInstance, AxiosProgressEvent } from 'axios';
import { createReadStream } from 'fs';
import { stat } from 'fs/promises';
import { lookup } from 'mime-types';
import { WeebifyV1Manifest } from './weebifyManifest';

interface MediaErrorResponse {
    error: string;
    errors?: string[];
}

interface CreateV0Response {
    video: {
        key: string;
        id: string;
    };
}

interface UploadKey {
    src: string;
    key: string;
}

interface CreateV1Response {
    video: {
        keys: UploadKey[];
        id: string;
    };
}

export enum VideoStatus {
    OK = 'OK',
    Failed = 'FAILED',
}

interface VerifyResponse {
    video: {
        status: VideoStatus;
        missingFiles: string[];
    };
}

export class WeebifyInstance {
    protected api: AxiosInstance;

    constructor(instanceUrl: string, token: string) {
        const url = new URL(instanceUrl);
        url.pathname = '/api/media/video';

        this.api = axios.create({
            baseURL: url.toString(),
            headers: {
                Authorization: `Bearer ${token}`,
            },
        });
    }

    async checkAuth() {
        const res = await this.api.get('/auth');

        if (res.status !== 200) {
            throw new Error('Invalid token or instance');
        }

        return true;
    }

    async createV0(jobname: string) {
        const res = await this.api.post('/create/v0', {
            job: jobname,
        });

        if (res.status !== 200) {
            const error = await res.data;
            throw new Error(`${res.status}: ${error}`);
        }

        const response = res.data as CreateV0Response | MediaErrorResponse;

        if ('error' in response) {
            throw response;
        }

        return response;
    }

    async createV1(manifest: WeebifyV1Manifest) {
        const res = await this.api.post('/create/v1', {
            job: manifest.job,
            subtitles: manifest.subtitles,
            fontMap: manifest.fontMap,
            audio: manifest.audio,
            videos: manifest.videos,
            chapters: manifest.chapters,
        });

        if (res.status !== 200) {
            const error = await res.data;
            throw new Error(`${res.status}: ${error}`);
        }

        const response = res.data as CreateV1Response | MediaErrorResponse;

        if ('error' in response) {
            throw response;
        }

        return response;
    }

    async verify(id: string) {
        const res = await this.api.post(`/verify/${id}`);

        if (res.status !== 200) {
            const error = res.data;
            throw new Error(`${res.status}: ${error}`);
        }

        const { video } = res.data as VerifyResponse;

        if (video.status != VideoStatus.OK) {
            throw video;
        }

        return true;
    }

    async s3PresignedPut(
        key: string,
        path: string,
        progress?: (p: AxiosProgressEvent) => void,
    ) {
        const contentType = lookup(path) || 'application/octet-stream';

        const size = (await stat(path)).size;
        const stream = createReadStream(path);

        await axios.put(key, stream, {
            headers: {
                'Content-Type': contentType,
                'Content-Length': size,
            },
            onUploadProgress: progress,
        });

        return true;
    }
}
