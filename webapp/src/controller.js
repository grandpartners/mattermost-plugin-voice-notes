let opener = null;

export const registerOpener = (fn) => {
    opener = fn;
};

export const openRecorder = (target) => {
    if (opener) {
        opener(target);
    }
};
