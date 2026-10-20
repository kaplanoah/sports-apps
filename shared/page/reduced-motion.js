// Whether the device asks for less motion, which every motion on the page checks.
export const prefersReducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
