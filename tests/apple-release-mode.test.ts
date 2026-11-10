import { describe, expect, it } from 'vitest';
// @ts-expect-error The dependency-free workflow helper is ESM JavaScript.
import { prepareAppleReleaseMode } from '../scripts/apple-release-mode.mjs';

function fixture({state='PREPARE_FOR_SUBMISSION',build='6',processing='VALID',releaseType='MANUAL',readback=true}={}) {
  const mutations: {path:string;method:string;data:unknown}[]=[];
  const version={id:'tested-version',attributes:{versionString:'0.3.0',appStoreState:state,releaseType}};
  const apple=async(path:string,method='GET',data?:{attributes:{releaseType:string}})=>{
    if(method!=='GET') {
      mutations.push({path,method,data});
      if(readback) version.attributes.releaseType=data!.attributes.releaseType;
      return {data:version};
    }
    if(path.includes('/apps/')) return {data:[version]};
    if(path.endsWith('/build')) return {data:{attributes:{version:build,processingState:processing}}};
    return {data:version};
  };
  return {apple,mutations,version,candidate:{version:'0.3.0',iosBuildNumber:6}};
}
describe('Apple automatic release configuration',()=>{
  it('sets and verifies automatic release for the exact tested draft',async()=>{
    const f=fixture();await prepareAppleReleaseMode(f.apple,f.candidate);
    expect(f.mutations).toEqual([{path:'/v1/appStoreVersions/tested-version',method:'PATCH',data:{type:'appStoreVersions',id:'tested-version',attributes:{releaseType:'AFTER_APPROVAL'}}}]);
  });
  it('can configure a waiting review without creating or resubmitting a review',async()=>{
    const f=fixture({state:'WAITING_FOR_REVIEW'});await prepareAppleReleaseMode(f.apple,f.candidate,true);
    expect(f.mutations).toHaveLength(1);expect(f.mutations[0].path).toBe('/v1/appStoreVersions/tested-version');
  });
  it('does not let the normal submission path overwrite an existing review',async()=>{
    const f=fixture({state:'IN_REVIEW'});await expect(prepareAppleReleaseMode(f.apple,f.candidate)).rejects.toThrow('eligible');expect(f.mutations).toHaveLength(0);
  });
  it('rejects a different version, build, or unprocessed build before a mutation',async()=>{
    for(const options of [{build:'5'},{processing:'PROCESSING'},{}]) {
      const f=fixture(options);if(!Object.keys(options).length)f.candidate.version='0.2.0';
      await expect(prepareAppleReleaseMode(f.apple,f.candidate,true)).rejects.toThrow();expect(f.mutations).toHaveLength(0);
    }
  });
  it('verifies existing automatic release without repeating its mutation',async()=>{
    const f=fixture({releaseType:'AFTER_APPROVAL'});await prepareAppleReleaseMode(f.apple,f.candidate);expect(f.mutations).toHaveLength(0);
  });
  it('fails if Apple does not retain the requested release mode',async()=>{
    const f=fixture({readback:false});await expect(prepareAppleReleaseMode(f.apple,f.candidate,true)).rejects.toThrow('readback');
  });
});
