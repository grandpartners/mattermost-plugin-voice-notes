import React from 'react';

const svg = (path, viewBox = '0 0 24 24') => (props) => (
    <svg
        width={props.size || 16}
        height={props.size || 16}
        viewBox={viewBox}
        fill='currentColor'
        aria-hidden='true'
    >
        {path}
    </svg>
);

export const MicIcon = svg(
    <>
        <path d='M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3z'/>
        <path d='M17 11a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2z'/>
    </>,
);

export const PlayIcon = svg(<path d='M8 5.14v13.72L19 12 8 5.14z'/>);

export const PauseIcon = svg(<path d='M7 5h3.5v14H7zM13.5 5H17v14h-3.5z'/>);

export const StopIcon = svg(<rect x='6' y='6' width='12' height='12' rx='2'/>);

export const SendIcon = svg(<path d='M2.7 20.6 22 12 2.7 3.4l-.01 6.68L16 12 2.69 13.92z'/>);

export const TrashIcon = svg(
    <path d='M9 3h6l1 2h4v2H4V5h4l1-2zM6 8h12l-.9 12.1a2 2 0 0 1-2 1.9H8.9a2 2 0 0 1-2-1.9L6 8zm4 3v8h1.5v-8H10zm3 0v8h1.5v-8H13z'/>,
);

export const DownloadIcon = svg(
    <path d='M11 3h2v9.17l3.09-3.09L17.5 10.5 12 16l-5.5-5.5 1.41-1.42L11 12.17V3zM4 19h16v2H4z'/>,
);
