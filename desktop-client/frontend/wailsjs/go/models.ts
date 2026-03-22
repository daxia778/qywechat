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

