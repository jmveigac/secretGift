import { useEffect, useRef, useState } from 'react';
import artwork from './assets/gift-illustration.webp?inline';
import { GiftMark } from './VisualIdentity';

export default function GiftIllustration() {
    const target = useRef<HTMLCanvasElement>(null);
    const [ready, setReady] = useState(false);
    useEffect(() => {
        if (typeof createImageBitmap !== 'function') return;
        const canvas = target.current;
        const context = canvas?.getContext('2d');
        if (!canvas || !context) return;
        let active = true;
        // Decode the bundled image directly, without a URL or a new static route.
        const bytes = Uint8Array.from(atob(artwork.split(',')[1]), char => char.charCodeAt(0));
        void createImageBitmap(new Blob([bytes], { type: 'image/webp' })).then(bitmap => {
            try {
                if (!active) return;
                canvas.width = bitmap.width;
                canvas.height = bitmap.height;
                context.drawImage(bitmap, 0, 0);
                setReady(true);
            } finally { bitmap.close(); }
        }).catch(() => {});
        return () => { active = false; };
    }, []);
    return <div className="hero-art" aria-hidden="true">
        {!ready && <GiftMark className="hero-mark" />}
        <canvas ref={target} hidden={!ready} />
    </div>;
}
