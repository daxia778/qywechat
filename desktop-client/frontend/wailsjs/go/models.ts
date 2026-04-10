export namespace main {
	
	export class AppUpdateInfo {
	    version: string;
	    force_update: boolean;
	    download_url: string;
	    release_notes: string;
	    has_update: boolean;
	
	    static createFrom(source: any = {}) {
	        return new AppUpdateInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.version = source["version"];
	        this.force_update = source["force_update"];
	        this.download_url = source["download_url"];
	        this.release_notes = source["release_notes"];
	        this.has_update = source["has_update"];
	    }
	}
	export class FollowStaffItem {
	    id: number;
	    name: string;
	    wecom_userid: string;
	    status: string;
	    is_online: boolean;
	    active_orders: number;
	
	    static createFrom(source: any = {}) {
	        return new FollowStaffItem(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.wecom_userid = source["wecom_userid"];
	        this.status = source["status"];
	        this.is_online = source["is_online"];
	        this.active_orders = source["active_orders"];
	    }
	}
	export class LoginResult {
	    success: boolean;
	    message: string;
	    name: string;
	    wecom_uid: string;
	
	    static createFrom(source: any = {}) {
	        return new LoginResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.success = source["success"];
	        this.message = source["message"];
	        this.name = source["name"];
	        this.wecom_uid = source["wecom_uid"];
	    }
	}
	export class OCRResult {
	    order_sn: string;
	    price: number;
	    raw_price: string;
	    order_time: string;
	    confidence: number;
	    screenshot_url: string;
	    screenshot_hash: string;
	    error?: string;
	
	    static createFrom(source: any = {}) {
	        return new OCRResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.order_sn = source["order_sn"];
	        this.price = source["price"];
	        this.raw_price = source["raw_price"];
	        this.order_time = source["order_time"];
	        this.confidence = source["confidence"];
	        this.screenshot_url = source["screenshot_url"];
	        this.screenshot_hash = source["screenshot_hash"];
	        this.error = source["error"];
	    }
	}
	export class ParseTextResult {
	    contact: string;
	    contact_type: string;
	    theme: string;
	    pages: number;
	    deadline: string;
	    remark: string;
	    raw_text: string;
	    confidence: string;
	    from_cache: boolean;
	    error?: string;
	
	    static createFrom(source: any = {}) {
	        return new ParseTextResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.contact = source["contact"];
	        this.contact_type = source["contact_type"];
	        this.theme = source["theme"];
	        this.pages = source["pages"];
	        this.deadline = source["deadline"];
	        this.remark = source["remark"];
	        this.raw_text = source["raw_text"];
	        this.confidence = source["confidence"];
	        this.from_cache = source["from_cache"];
	        this.error = source["error"];
	    }
	}
	export class SubmitResult {
	    success: boolean;
	    message: string;
	    order_sn: string;
	
	    static createFrom(source: any = {}) {
	        return new SubmitResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.success = source["success"];
	        this.message = source["message"];
	        this.order_sn = source["order_sn"];
	    }
	}
	export class UploadAttachmentResult {
	    url: string;
	    error?: string;
	
	    static createFrom(source: any = {}) {
	        return new UploadAttachmentResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.url = source["url"];
	        this.error = source["error"];
	    }
	}

}

