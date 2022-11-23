#  Copyright (c) Microsoft Corporation. All rights reserved.
#  Licensed under the MIT License. See License.txt in the project root for license information.
ARG BASE_IMAGE
FROM $BASE_IMAGE

USER root

ARG REMOTE_USER
ARG IGNORE_PATTERN
ARG NEW_UID
ARG NEW_GID
SHELL ["/bin/sh", "-c"]
RUN eval $(sed -n "s/${REMOTE_USER}:[^:]*:\([^:]*\):\([^:]*\):[^:]*:\([^:]*\).*/OLD_UID=\1;OLD_GID=\2;HOME_FOLDER=\3/p" /etc/passwd); \
	eval $(sed -n "s/\([^:]*\):[^:]*:${NEW_UID}:.*/EXISTING_USER=\1/p" /etc/passwd); \
	eval $(sed -n "s/\([^:]*\):[^:]*:${NEW_GID}:.*/EXISTING_GROUP=\1/p" /etc/group); \
	if [ -z "$OLD_UID" ]; then \
		echo "Remote user not found in /etc/passwd ($REMOTE_USER)."; \
	elif [ "$OLD_UID" = "$NEW_UID" -a "$OLD_GID" = "$NEW_GID" ]; then \
		echo "UIDs and GIDs are the same ($NEW_UID:$NEW_GID)."; \
	elif [ "$OLD_UID" != "$NEW_UID" -a -n "$EXISTING_USER" ]; then \
		echo "User with UID exists ($EXISTING_USER=$NEW_UID)."; \
	elif [ "$OLD_GID" != "$NEW_GID" -a -n "$EXISTING_GROUP" ]; then \
		echo "Group with GID exists ($EXISTING_GROUP=$NEW_GID)."; \
	else \
		echo "Updating UID:GID from $OLD_UID:$OLD_GID to $NEW_UID:$NEW_GID."; \
		sed -i -e "s/\(${REMOTE_USER}:[^:]*:\)[^:]*:[^:]*/\1${NEW_UID}:${NEW_GID}/" /etc/passwd; \
		if [ "$OLD_GID" != "$NEW_GID" ]; then \
			sed -i -e "s/\([^:]*:[^:]*:\)${OLD_GID}:/\1${NEW_GID}:/" /etc/group; \
		fi; \
	find $HOME_FOLDER -path $IGNORE_PATTERN -prune -o -print0 | xargs -0 chown $NEW_UID:$NEW_GID; \
	fi;

ARG IMAGE_USER
USER $IMAGE_USER
