/** Claude model tool_use blocks are untrusted proposals, not executable calls.
 *
 * MCP tools/call is the authorization boundary: Claude Code invokes it only
 * after its own permissions and PreToolUse hooks have allowed that tool.
 * A model may suggest two parallel tools but Claude Code can authorize them
 * sequentially, after the first result. Therefore proposals MUST outlive one
 * OMP provider turn. An approved tool is dispatched into the first available
 * OMP stream; unapproved or denied siblings are never executed.
 */
import { isDeepStrictEqual } from "node:util";

export interface AuthorizedToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}
interface Proposal {
  id: string;
  name: string;
  index: number;
  json: string;
  initial: Record<string, unknown>;
  completed: boolean;
  approved: Record<string, unknown> | null;
}

export class ToolDispatchGate {
  private readonly proposals = new Map<string, Proposal>();
  private readonly byIndex = new Map<number, string>();
  private readonly dispatchedIds = new Set<string>();
  private onDispatch: ((calls: AuthorizedToolCall[]) => void) | null = null;
  private canDispatch: (() => boolean) | null = null;
  private messageStopped = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

  // Batch immediately concurrent authorizations; *not* a deadline for a
  // sibling to be approved. A later authorized sibling gets a new OMP turn.
  constructor(private readonly batchMs = 25) {}

  setDispatcher(onDispatch: (calls: AuthorizedToolCall[]) => void, canDispatch: () => boolean): void {
    this.onDispatch = onDispatch;
    this.canDispatch = canDispatch;
  }

  /** An OMP tool-result continuation provided another stream for late approvals. */
  resume(): void {
    this.scheduleDispatch();
  }

  beginMessage(): void {
    this.clearTimer();
    this.proposals.clear();
    this.byIndex.clear();
    this.messageStopped = false;
    // Keep dispatchedIds for the lifetime of the query: a duplicate tools/call
    // must never execute a tool a second time even after another model turn.
  }

  /** Query ended / aborted / rewritten. Clears every pending authorization. */
  reset(): void {
    this.beginMessage();
    this.dispatchedIds.clear();
  }

  propose(id: string, name: string, index: number, input: unknown): void {
    if (this.dispatchedIds.has(id) || this.proposals.has(id) || !id || !name) return;
    this.proposals.set(id, {id,name,index,json:"",initial:isPlainRecord(input)?input:{},completed:false,approved:null});
    this.byIndex.set(index,id);
  }

  append(index: number, delta: string): boolean {
    const id=this.byIndex.get(index);
    if(id===undefined)return false;
    const p=this.proposals.get(id);
    if(!p)return false;
    p.json+=delta;
    return true;
  }

  complete(index: number): boolean {
    const id=this.byIndex.get(index);
    if(id===undefined)return false;
    const p=this.proposals.get(id);
    if(!p)return false;
    p.completed=true;
    this.scheduleDispatch();
    return true;
  }

  stageComplete(id: string,name: string,index:number,input:unknown):void {
    this.propose(id,name,index,input);
    const p=this.proposals.get(id);
    if(p)p.completed=true;
  }

  dropIncomplete():void {
    for(const [id,p] of this.proposals){
      if(p.completed)continue;
      this.proposals.delete(id);
      this.byIndex.delete(p.index);
    }
  }

  /** Call only from an actual MCP tools/call request, never a streamed tool_use. */
  authorize(id: string,name: string,mcpArgs: unknown): boolean {
    if(this.dispatchedIds.has(id))return false;
    const p=this.proposals.get(id);
    if(!p||!p.completed||p.approved||p.name!==name||!isPlainRecord(mcpArgs))return false;
    if(!isDeepStrictEqual(parseArgs(p),mcpArgs))return false;
    p.approved=mcpArgs;
    this.scheduleDispatch();
    return true;
  }

  deny(id:string):void {
    const p=this.proposals.get(id);
    if(!p||p.approved)return;
    this.proposals.delete(id);
    this.byIndex.delete(p.index);
    this.scheduleDispatch();
  }

  finishMessage():void {
    this.messageStopped=true;
    this.dropIncomplete();
    this.scheduleDispatch();
  }

  hasProposed(id:string):boolean{return this.proposals.has(id);}
  get proposedCount():number{return this.proposals.size;}
  get dispatchedCount():number{return this.dispatchedIds.size;}

  private clearTimer():void {
    if(this.timer)clearTimeout(this.timer);
    this.timer=null;
  }

  private scheduleDispatch():void {
    if(!this.messageStopped||!this.canDispatch?.())return;
    const ready=[...this.proposals.values()].filter(p=>p.completed&&p.approved);
    if(!ready.length)return;
    if(!this.timer)this.timer=setTimeout(()=>this.flushApproved(),this.batchMs);
  }

  private flushApproved():void {
    this.clearTimer();
    if(!this.messageStopped||!this.canDispatch?.())return;
    const ready=[...this.proposals.values()].filter(p=>p.completed&&p.approved);
    if(!ready.length)return;
    // Delete before delivering OMP events to prevent reentrant duplicate calls.
    for(const p of ready){
      this.proposals.delete(p.id);
      this.byIndex.delete(p.index);
      this.dispatchedIds.add(p.id);
    }
    this.onDispatch?.(ready.map(p=>({id:p.id,name:p.name,arguments:p.approved!})));
  }
}

function isPlainRecord(v: unknown): v is Record<string,unknown> {
  return typeof v==="object" && v!==null && !Array.isArray(v);
}
function parseArgs(p: Proposal):Record<string,unknown>{
  if(!p.json)return p.initial;
  try{const v=JSON.parse(p.json);return isPlainRecord(v)?v:{};}
  catch{return {};}
}
