class ToastStore {
	message = $state('');
	type = $state<'info' | 'error'>('info');
	href = $state('');
	linkText = $state('');
	visible = $state(false);
	private timer: any = null;

	show(message: string, type: 'info' | 'error' = 'info', duration = 3000) {
		this.message = message;
		this.type = type;
		this.href = '';
		this.linkText = '';
		this.visible = true;

		if (this.timer) clearTimeout(this.timer);
		if (duration > 0) {
			this.timer = setTimeout(() => {
				this.visible = false;
			}, duration);
		}
	}

	showLink(message: string, linkText: string, href: string) {
		this.message = message;
		this.type = 'info';
		this.linkText = linkText;
		this.href = href;
		this.visible = true;

		if (this.timer) clearTimeout(this.timer);
	}

	dismiss() {
		this.visible = false;
	}
}

export const toast = new ToastStore();
