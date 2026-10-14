const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../script.js'),'utf8');
function fn(name){const i=source.indexOf('  function '+name+'(');return source.slice(i,source.indexOf('\n  }',i)+4);}
test('current advanced edits and entry switches block publish before any persistence',()=>{
 let writes=0;const c={editingDiaryId:'a',simpleDiaryEditingId:'a',simpleDiaryBusy:false,simpleDiaryPendingConfirm:true,
 readWebDiaryFormValues:()=>({content:'current'}),simpleDiarySourceValues:JSON.stringify({content:'previous'}),setSimpleDiaryStatus(){},saveWebDiary(){writes++;}};
 vm.createContext(c);vm.runInContext(fn('simpleDiaryContextMatches')+'\n'+fn('publishSimpleDiary'),c);
 c.publishSimpleDiary();assert.equal(writes,0);assert.equal(c.simpleDiaryPendingConfirm,false);
 c.simpleDiarySourceValues=JSON.stringify({content:'current'});c.editingDiaryId='b';c.simpleDiaryPendingConfirm=true;
 c.publishSimpleDiary();assert.equal(writes,0);assert.equal(c.simpleDiaryPendingConfirm,false);
});
test('opening simple composer does not clear an existing advanced draft or photos',()=>{
 const photos=[{id:'existing-image'}],advanced={title:'existing title',content:'existing body'};let opened=false;
 const c={simpleDiaryEditingId:null,readWebDiaryFormValues:()=>advanced,diaryImageItems:photos,showToast(){},setModalOpen(){opened=true;}};
 vm.createContext(c);vm.runInContext(fn('openSimpleDiary'),c);c.openSimpleDiary();
 assert.equal(opened,false);assert.equal(c.diaryImageItems,photos);assert.equal(advanced.content,'existing body');
});
