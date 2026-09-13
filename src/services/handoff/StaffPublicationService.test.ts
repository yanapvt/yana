import { describe,expect,it,vi } from 'vitest';
import { StaffPublicationHandler } from './StaffPublicationService.js';
const item:any={notificationId:'n',handoffId:'h',type:'human_handoff_requested',correlationId:'c'};
describe('StaffPublicationHandler',()=>{
 it('does not claim delivery while disabled',async()=>{const publish=vi.fn();await expect(new StaffPublicationHandler(false,{publish}).handle(item)).rejects.toMatchObject({code:'PUBLICATION_DISABLED'});expect(publish).not.toHaveBeenCalled();});
 it('uses safe fallback after primary failure',async()=>{const fallback=vi.fn().mockResolvedValue({receiptId:'r'});await new StaffPublicationHandler(true,{publish:vi.fn().mockRejectedValue(Object.assign(new Error('secret'),{code:'TEMP'}))},{publish:fallback}).handle(item);expect(fallback).toHaveBeenCalledOnce();});
});
