// VSScript 79 invokes `vapoursynth config` to register its Python interpreter.
// Use a native launcher so all executable code in Contents/MacOS can be signed.
#include <mach-o/dyld.h>
#include <limits.h>
#include <libgen.h>
#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>
int main(int argc,char** argv){
    char executable[PATH_MAX],resolved[PATH_MAX],python[PATH_MAX],home[PATH_MAX],packages[PATH_MAX];
    uint32_t size=sizeof(executable);
    if(_NSGetExecutablePath(executable,&size)||!realpath(executable,resolved))return 1;
    const char* directory=dirname(resolved);
    if(snprintf(python,sizeof(python),"%s/tigerest-python",directory)>=PATH_MAX)return 1;
    if(snprintf(home,sizeof(home),"%s/../Resources/python",directory)>=PATH_MAX)return 1;
    if(snprintf(packages,sizeof(packages),"%s/lib/python" TIGEREST_PYTHON_VERSION "/site-packages",home)>=PATH_MAX)return 1;
    setenv("PYTHONHOME",home,1);setenv("PYTHONPATH",packages,1);
    setenv("PYTHONNOUSERSITE","1",1);setenv("PYTHONDONTWRITEBYTECODE","1",1);
    char** arguments=calloc((size_t)argc+3,sizeof(char*));if(!arguments)return 1;
    arguments[0]=python;arguments[1]="-m";arguments[2]="vapoursynth";
    for(int i=1;i<argc;++i)arguments[i+2]=argv[i];
    execv(python,arguments);perror("bundled Python");free(arguments);return 1;
}
