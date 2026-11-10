import { validateProject, type Project } from "./project";

const DB_NAME = "xr-daw";
async function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore("projects");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export async function saveProject(project: Project): Promise<void> {
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction("projects", "readwrite");
      transaction.objectStore("projects").put(project, "autosave");
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () =>
        reject(transaction.error ?? new Error("Save aborted."));
    });
  } finally {
    db.close();
  }
}
export async function restoreProject(): Promise<Project | null> {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const request = db
        .transaction("projects")
        .objectStore("projects")
        .get("autosave");
      request.onsuccess = () => {
        try {
          resolve(request.result ? validateProject(request.result) : null);
        } catch (error) {
          reject(error);
        }
      };
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}
