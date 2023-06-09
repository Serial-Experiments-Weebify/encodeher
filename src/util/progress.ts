import { Preset, Options } from 'cli-progress';

export const PROGRESS_PRESET: Preset = {
    format: '{job}: [{bar}] ({eta_formatted}) | [{value}/{total}] {status} ',
    barCompleteChar: '=',
    barIncompleteChar: '-',
};

export const PROGRESS_CONF: [Options, Preset] = [
    {
        clearOnComplete: false,
        hideCursor: true,
        autopadding: true,
    },
    PROGRESS_PRESET,
];
