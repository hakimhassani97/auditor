export type PreparationFile={id:string;filename:string};
export type PreparationResult<T>={report:T;failures:Array<{filename:string;reason:string}>};

/** Runs the opt-in batch sequentially and still builds a report when individual analyses fail. */
export async function prepareProject<T>(projectId:string,files:PreparationFile[],fetcher:typeof fetch,onProgress:(index:number,total:number,file:PreparationFile)=>void=()=>{}):Promise<PreparationResult<T>>{
 const failures:PreparationResult<T>["failures"]=[];
 for(let index=0;index<files.length;index++){
  const file=files[index];onProgress(index+1,files.length,file);
  try{
   const response=await fetcher(`/api/projects/${projectId}/process`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({evidenceId:file.id})});
   if(!response.ok){const body=await response.json().catch(()=>({}));failures.push({filename:file.filename,reason:body.error||`Analysis failed (HTTP ${response.status}).`})}
  }catch(error){failures.push({filename:file.filename,reason:error instanceof Error?error.message:"Network error during analysis."})}
 }
 const response=await fetcher(`/api/projects/${projectId}/report`,{method:"POST"});
 const report=await response.json().catch(()=>({}));
 if(!response.ok)throw new Error(report.error||"Could not generate the preparation draft.");
 return {report:report as T,failures};
}
