// eslint-disable-next-line no-unused-vars
import { ActionDispatcher, Store } from "../actions.js";
import { createElement } from "../lib.js";
import { PlayerToolbar } from "./PlayerToolbar.js";

/**
 * @param {ActionDispatcher} actions
 * @param {Store} store
 */
export async function UnknownPlayer(actions, store) {
	const toolbar = await PlayerToolbar(actions, store);

	return {
		el: createElement(
			"div",
			{
				className: "c-unknown-player",
			},
			toolbar.el,
			createElement("div", { innerText: "UNKNOWN" }),
		),
		async unload() {
			await toolbar.unload();
		},
	};
}