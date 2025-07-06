// This file exists so I don't have to export this internal variable inside "core.js"
export const core_context = { is_mounted_to_the_DOM: false, onMountSet: new Set(), onUnmountSet: new Set() };

/** @type {Map<string, any>[]} */
export let contextQueue = [];

export function pushNewContext() {
    contextQueue.push(new Map());
    return [...contextQueue];
}

export function copyContextQueue() {
    return [...contextQueue];
}

/**
 * @param {Map<string, any[]} newContextQueue
 * @returns {() => void} revert back to the old context queue
 */
export function setContextQueue(newContextQueue) {
    const oldContextQueue = contextQueue;
    contextQueue = newContextQueue;
    return () => contextQueue = oldContextQueue;
}

/** @type {Set<Function>[]} */
export const onMountQueue = [];

/** @type {Set<Function>[]} */
export const onUnmountQueue = [];

/**
 * @template {any} T
 * @param {Set<Function>} onMountSet
 * @param {Set<Function>} onUnmountSet
 * @param {() => T} fn
 */
export function scopedMountUnmountRun(onMountSet, onUnmountSet, fn) {
    onUnmountQueue.push(onUnmountSet);
    onMountQueue.push(onMountSet);
    const value = fn();
    onMountQueue.pop();
    onUnmountQueue.pop();
    return value;
}
