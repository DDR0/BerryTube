const { events } = require("../log/events");
const settings = require("../../bt_data/settings");
const { now } = require("../utils");

const userTypes = (exports.userTypes = {
	LURKER: -2,
	ANONYMOUS: -1,
	USER: 0,
	MODERATOR: 1,
	ADMINISTRATOR: 2,
});

const userTypesToName = (exports.userTypesToName = {
	[userTypes.LURKER]: "Lurker",
	[userTypes.ANONYMOUS]: "Anonymous",
	[userTypes.USER]: "User",
	[userTypes.MODERATOR]: "Moderator",
	[userTypes.ADMINISTRATOR]: "Administrator",
});

exports.getSocketName = function(socket) {
	if (!socket) {
		return "Server";
	}

	return socket.session.systemName;
};

exports.Session = class {
	get isBerry() {
		return this === this.sessions.berrySession;
	}

	get publicData() {
		return { id: this.id, type: this.type, nick: this.nick };
	}

	get privilegedData() {
		return { ...this.publicData, ...this.shadowbanStatus, meta: this.meta };
	}

	get shadowbanStatus() {
		const shadowbanStatus = {
			shadowbanned: false,
			tempshadowbanned: false,
		};

		for (const socket of this.sockets) {
			const socketStatus = this.sessions.getShadowbanInfoForIp(socket.ip);

			shadowbanStatus.shadowbanned =
				shadowbanStatus.shadowbanned || socketStatus.is;

			shadowbanStatus.tempshadowbanned =
				shadowbanStatus.tempshadowbanned ||
				(socketStatus.is && socketStatus.isTemp);
		}

		return shadowbanStatus;
	}

	get isEmpty() {
		return this.sockets.length === 0;
	}

	get systemName() {
		return `session(${this.id}, ${this.nick}, ${this.typeName})`;
	}

	get typeName() {
		return userTypesToName[this.type];
	}

	constructor(services, id) {
		this.services = services;
		this.sessions = services.sessions;
		this.id = id;
		this.auth = services.auth;
		this.log = services.log;
		this.type = userTypes.LURKER;
		this.nick = "[no username]";
		this.hasNick = false;
		this.sockets = [];
	}

	emit(...args) {
		for (const socket of this.sockets) {
			socket.emit(...args);
		}
	}

	login(nick, type, meta) {
		this.hasNick = true;
		this.nick = nick;
		this.type = type;
		this.meta = meta;

		for (const socket of this.sockets) {
			socket.onAuthenticated();
		}
	}

	updateMeta(meta) {
		if (!this.hasNick) {
			return;
		}

		this.meta = meta;
	}

	addIoSocket(ioSocket) {
		const socket = new BerrySocket(this.services, ioSocket);
		this.addSocket(socket);
		return socket;
	}

	addSocket(socket) {
		socket.session = this;
		if (this.hasNick) {
			socket.onAuthenticated();
		}

		this.sockets.push(socket);
	}

	removeSocket(socket) {
		if (socket.session !== this) {
			return;
		}

		const index = this.sockets.indexOf(socket);
		if (index === -1) {
			return;
		}

		this.sockets.splice(index, 1);
	}

	kick(reason) {
		this.log.info(
			events.EVENT_ADMIN_KICKED,
			"{nick} got kicked because {reason}",
			{ nick: this.systemName, type: "user", reason },
		);

		for (const socket of this.sockets.slice()) {
			socket.emit("kicked", reason);
			socket.disconnect();
		}
	}

	/**
	 * Disconnect all sockets
	 */
	disconnect() {
		for (const socket of this.sockets) {
			socket.disconnect();
		}
	}
};

class BerrySocket {
	get disconnected() {
		return this.socket.disconnected;
	}

	get id() {
		return this.socket.id;
	}

	get ip() {
		return this.socket.handshake.headers["x-forwarded-for"];
	}

	constructor({ log }, socket) {
		this.log = log;
		this.socket = socket;
		this.lastSpamBlockAt = 0;
		this.spamBlockHp = -1;
		this.session = null;
		this.onAuthenticatedHandlers = [];
		this.isAuthenticated = false;

		socket.on("disconnect", () => (this.onAuthenticatedHandlers = []));
	}

	addOnAuthenticatedHandler(handler) {
		if (this.isAuthenticated) {
			handler(this);
			return () => {};
		}

		this.onAuthenticatedHandlers.push(handler);
		return () => {
			const index = this.onAuthenticatedHandlers.indexOf(handler);
			if (index === -1) {
				return;
			}

			this.onAuthenticatedHandlers.splice(index, 1);
		};
	}

	on(eventName, callback) {
		this.socket.on(eventName, async (...args) => {
			try {
				await Promise.resolve(callback(...args));
			} catch (e) {
				// eslint-disable-next-line no-console
				console.error(
					`Unhandled exception in socket handler of ${eventName}`,
				);
				// eslint-disable-next-line no-console
				console.error(e);
			}
		});
	}

	onAuthenticated() {
		this.emit("setNick", this.session.nick);
		this.emit("setType", this.session.type);

		for (const handler of this.onAuthenticatedHandlers) {
			handler(this);
		}

		this.onAuthenticatedHandlers = [];
		this.isAuthenticated = true;
	}

	/**
	 * Used for spam checking
	 * @returns {boolean} should the action be allowed to go though
	 */
	doSpamblockedAction() {
		let { lastSpamBlockAt, spamBlockHp } = this;
		if (lastSpamBlockAt == 0) {
			lastSpamBlockAt = new Date().getTime() - settings.core.spamhp;
		}

		if (spamBlockHp === -1) {
			spamBlockHp = settings.core.spamhp;
		}

		const currentTime = now();
		const deltaTime = currentTime - lastSpamBlockAt;
		const deltaHp = deltaTime - settings.core.spamcompare;
		spamBlockHp = Math.min(spamBlockHp + deltaHp, settings.core.spamhp);

		if (spamBlockHp < 0) {
			return false;
		}

		this.lastSpamBlockAt = lastSpamBlockAt;
		this.spamBlockHp = spamBlockHp;
		return true;
	}

	emit(...args) {
		this.socket.emit(...args);
	}

	disconnect() {
		this.onAuthenticatedHandlers = [];
		this.socket.disconnect();
	}
}
