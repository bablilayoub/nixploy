import { currentDatabaseTransaction, type DbExecutor, db, runWithDatabaseTransaction } from "../db";

/**
 * Better Auth passes its transaction to the adapter, but not to database
 * hooks. Keep that same executor available to the first-user admission hook:
 * its advisory lock must live until the user/account transaction commits.
 */
export const authDatabase: typeof db = new Proxy(db, {
	get(target, property, receiver) {
		if (property === "transaction") {
			const transaction: typeof db.transaction = (callback, config) =>
				db.transaction((tx) => runWithDatabaseTransaction(tx, () => callback(tx)), config);
			return transaction;
		}
		return Reflect.get(target, property, receiver);
	},
});

export function currentAuthTransaction(): DbExecutor | undefined {
	return currentDatabaseTransaction();
}
