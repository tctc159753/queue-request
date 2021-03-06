import axios from 'axios';
import { State, Options, RequestFn, Request } from './types';

const noop: () => void = function() {};
const urlReg = /^((https?|ftp|file):\/\/)?([\da-z\.-]+)\.([a-z\.]{2,6})([\/\w \.-]*)*\/?$/;

// TODO: add more comments
class Queue {
	options: Options;
	interval = 0;
	max = 1;
	cb: Function = noop;
	private _queue: Request [] = [];
	private _waiting: Request [] = [];
	private _running: Request [] = [];
	private _finished: any [] = [];
	private _promise: Promise<any> = null;
	private _state: State;
	private _needSort: boolean;
	private resolve: (v: any []) => void;
	private reject: (v: any []) => void;

	/**
	 * store options to queue
	 * can be changed in Options method
	 */
	constructor(options: Options = {}) {
		this.options = options;
		this.init();
	}

	/**
	 * @description init queue configuration, called in new Queue and Stop() cases
	 */
	private init(): void {
		this.interval = this.options.interval > 0 ? this.options.interval : 0;
		this.max = this.options.max > 1 ? this.options.max : 1;
		this.cb = typeof this.options.cb === 'function' ? this.options.cb : noop;
		this._queue = [];
		this._waiting = [];
		this._running = [];
		this._finished = [];
		this._promise = null;
		this.setState(State.Init);
	}

	/**
	 * @param {any}    requests 
	 * @param {number} priority 
	 * add request to queue
	 * once add queue, the queue should be sorted again
	 * Add will recursion array request
	 */
	Add(requests: any, priority = 0): Queue {
		if(requests) {
			this._needSort = true;
			if(Array.isArray(requests)) {
				requests.forEach(request => {
					this.Add(request, priority);
				});
			}else {
				this.handleRequest(requests, priority);
			}
		}

		return this;
	}

	/**
	 * two effects:
	 * 1. transform all requests to function which return a promise
	 * 2. add priority for every request to sort the queue
	 */
	private handleRequest(request: any, priority: number): void {
		const requestFn = this.generatorRequestFunc(request);
		const excutedRequestFn = this.addPriority(requestFn, priority);

		this._queue.push(excutedRequestFn);
		this._waiting.push(excutedRequestFn);
	}

	private generatorRequestFunc(request): RequestFn {
		if(typeof request !== 'function') {
			const isUrl = (url: string): boolean => urlReg.test(url);
			const getRequestFn = (config): RequestFn => () => axios(config);
			const defaultRequestFn = request => () => request;

			if(typeof request === 'string' && isUrl(request)) {
				const config = {
					url: request,
					method: 'get'
				};

				return getRequestFn(config);
			}else if(typeof request === 'object' && request.url) {
				return getRequestFn(request);
			}else {
				return defaultRequestFn(request);
			}
		}else {
			return request;
		}
	}

	private addPriority(requestFn: RequestFn, priority: number): Request {
		priority = typeof priority === 'number' ? priority : 0;
		const request = requestFn as Request;

		request.priority = priority;
		return request;
	}

	/**
	 * get queue to run, genertor a final promise
	 * 
	 */
	Run(): void {
		if(this._state !== State.Running && (this._promise === null || this._state === State.Finish)) {
			this._promise = new Promise((resolve, reject) => {
				this.resolve = resolve;
				this.reject = reject;
				this.handleQueue();
			});
		}
	}

	private handleQueue(): void {
		const waits = this._waiting.length;
		const requestNum = this.max <= waits ? this.max : waits;

		if(waits) {
			this.setState(State.Running);
			this._needSort && this.sortWaiting();
			this._running.push(...this._waiting.splice(0, requestNum));
			this.excuteTask();
		}
	}

	/**
	 * @description sort waiting requests by priority, worked after by calling Add()
	 */
	private sortWaiting(): void {
		this._waiting.sort((a, b) => b.priority - a.priority);
		this._needSort = false;
	}

	private excuteTask(): void {
		const requests: Promise<any> [] = [];

		for(const request of this._running) {
			requests.push(request());
		}

		const rlength = requests.length;
		
		Promise.all(requests).then(result => {
			this._finished.push(...result);
			this._running.splice(0, rlength);
			this.cb(result, this);
			if(this._state === State.Pause) {
				this.resolve(this._finished);
				return;
			}
			if(this._waiting.length) {
				setTimeout(() => {
					this.handleQueue();
				}, this.interval);
			}else {
				this.setState(State.Finish);
				this.resolve(this._finished);
			}
		}).catch(err => {
			this.reject(err);
		});
	}

	Stop(): void {
		this.setState(State.Stop);
		this.init();
	}

	// pause queue
	Pause(): void {
		if(this._state === State.Running) {
			this.setState(State.Pause);
		}
	}

	// make queue run only the queue state is pause
	Continue(): void {
		if(this._state === State.Pause) {
			this._promise = new Promise((resolve, reject) => {
				this.resolve = resolve;
				this.reject = reject;
			});
			this.handleQueue();
		}
	}

	// change the state of queue 
	private setState(state: State): void {
		this._state = state;
	}

	/**
	 * return the final promise
	 * @return {Promise} 
	 */
	Result(): Promise<any> {
		return this._promise === null ? Promise.resolve([]) : this._promise;
	}

	/**
	 * set options dynamically
	 */
	Options(options: Options): void {
		this.interval = options.interval > 0 ? (this.options.interval = options.interval) : this.interval;
		this.max = options.max > 1 ?  (this.options.max = options.max) : this.max;
		this.cb = typeof options.cb === 'function' ? (this.options.cb = options.cb) : this.cb;
	}
}

export default Queue;
