import React, {useEffect, useState} from 'react';

import {registerOpener} from '../controller';

import RecorderPanel from './recorder_panel';

export default function Root() {
    const [target, setTarget] = useState(null);

    useEffect(() => {
        registerOpener((t) => setTarget({...t, openedAt: Date.now()}));
        return () => registerOpener(null);
    }, []);

    if (!target) {
        return null;
    }
    return (
        <RecorderPanel
            key={target.openedAt}
            target={target}
            onClose={() => setTarget(null)}
        />
    );
}
