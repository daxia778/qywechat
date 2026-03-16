export namespace main {
	
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

}

