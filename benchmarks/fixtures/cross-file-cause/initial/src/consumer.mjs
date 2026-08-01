import { produceUser } from "./producer.mjs";
export function displayName(name) { return produceUser(name).label.toUpperCase(); }
