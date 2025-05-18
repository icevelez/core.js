// This file exists so I don't have to export this internal variable inside "core.js"

/**
* @type {Set<Function>[]}
*/
export const onMountQueue = [];

/**
* @type {Set<Function>[]}
*/
export const onUnmountQueue = [];
