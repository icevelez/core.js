// This file exists so I don't have to export this internal variable inside "core.js"

export const core_context = { mounted: false, mounts: new Set() };

/**
* @type {Set<Function>[]}
*/
export const onMountQueue = [];

/**
* @type {Set<Function>[]}
*/
export const onUnmountQueue = [];
