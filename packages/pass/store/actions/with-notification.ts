import type { Action, UnknownAction } from 'redux';

import type { CreateNotificationOptions, NotificationType } from '@proton/components/index';
import type { ClientEndpoint } from '@proton/pass/types';
import { merge } from '@proton/pass/utils/object/merge';
import { getApiErrorMessage } from '@proton/shared/lib/api/helpers/apiErrorHelper';

export type Notification = CreateNotificationOptions & { endpoint?: ClientEndpoint; loading?: boolean };
export type WithNotification<T = UnknownAction> = T & { meta: { notification: Notification } };
export type NotificationOptions = Notification &
    ({ type: 'error'; error: unknown } | { type: Exclude<NotificationType, 'error'> });

/* type guard utility */
export const isActionWithNotification = <T extends Action>(action?: T): action is WithNotification<T> =>
    (action as any)?.meta?.notification !== undefined;

const parseNotification = (notification: NotificationOptions): Notification => {
    switch (notification.type) {
        case 'success':
        case 'info':
        case 'warning':
            return notification;
        case 'error': {
            const errorMessage =
                notification.error instanceof Error
                    ? getApiErrorMessage(notification.error) ?? notification.error.message
                    : undefined;
            const serializedNotification: Notification = {
                ...notification,
                text: errorMessage ? `${notification.text} (${errorMessage})` : notification.text,
            };

            return serializedNotification;
        }
    }
};

const withNotification =
    (options: NotificationOptions) =>
    <T extends object>(action: T): WithNotification<T> => {
        const notification = parseNotification(options);

        return merge(action, { meta: { notification } });
    };

export default withNotification;
