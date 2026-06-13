import "./internal.js";
//#region src/lib/toast.svelte.ts
var ToastStore = class {
	message = "";
	type = "info";
	href = "";
	linkText = "";
	visible = false;
	timer = null;
	show(message, type = "info", duration = 3e3) {
		this.message = message;
		this.type = type;
		this.href = "";
		this.linkText = "";
		this.visible = true;
		if (this.timer) clearTimeout(this.timer);
		if (duration > 0) this.timer = setTimeout(() => {
			this.visible = false;
		}, duration);
	}
	showLink(message, linkText, href) {
		this.message = message;
		this.type = "info";
		this.linkText = linkText;
		this.href = href;
		this.visible = true;
		if (this.timer) clearTimeout(this.timer);
	}
	dismiss() {
		this.visible = false;
	}
};
var toast = new ToastStore();
//#endregion
export { toast as t };
