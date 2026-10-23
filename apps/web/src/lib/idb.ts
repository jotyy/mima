// One IndexedDB object store, keyed by account ID, opened for each request. Each kind of
// data keeps a database of its own, so their versions never have to move together.

export function objectStore(database: string, store: string) {
	return function request<T>(
		mode: IDBTransactionMode,
		work: (objects: IDBObjectStore) => IDBRequest<T>,
	): Promise<T> {
		return new Promise((resolve, reject) => {
			const opening = indexedDB.open(database, 1);
			opening.onupgradeneeded = () => {
				opening.result.createObjectStore(store, { keyPath: "accountId" });
			};
			opening.onerror = () => reject(opening.error);
			opening.onsuccess = () => {
				const db = opening.result;
				const transaction = db.transaction(store, mode);
				const result = work(transaction.objectStore(store));
				transaction.oncomplete = () => {
					db.close();
					resolve(result.result);
				};
				transaction.onerror = () => {
					db.close();
					reject(transaction.error);
				};
			};
		});
	};
}
