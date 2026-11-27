const paths = {
    chevron: 'm9 6 6 6-6 6',
    edit: 'm14 6 4 4M4 20l4-.8L20 7l-3-3L5 16l-1 4Z',
    trash: 'M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v5m4-5v5',
    mail: 'M3 6h18v12H3z M3 7l9 6 9-6',
    bell: 'M6 10a6 6 0 0 1 12 0v4l2 3H4l2-3zm4 10h4',
    repeat: 'M4 9h15l-3-3m3 3-3 3M20 15H5l3 3m-3-3 3-3',
    refresh: 'M20 7v5h-5m5 0a8 8 0 1 0-2 5',
    results: 'M3 12s3-6 9-6 9 6 9 6-3 6-9 6-9-6-9-6Zm11 0a2 2 0 1 1-4 0 2 2 0 0 1 4 0Z',
} as const;

export default function ActionIcon({ icon }: { icon: keyof typeof paths }) {
    return <svg className="action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" focusable="false" aria-hidden="true">
        <path d={paths[icon]} />
    </svg>;
}
