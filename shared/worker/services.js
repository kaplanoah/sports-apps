// The services each app's Worker binds, as services/ holds them. A binding answers any name, so a
// Worker can't list its services from its bindings and reads them here instead.
export const SERVICES = ["accounts"];

/**
 * The binding an app reaches a service by, its name in capitals.
 * @param {string} service
 */
export const nameServiceBinding = (service) => service.toUpperCase().replaceAll("-", "_");
