import { config } from '../config.js';

export const isUserAdmin = (userId?: number): boolean => {
	if (!userId) return false;
	return config.ADMIN_USER_IDS.includes(userId);
};