#include "local.h"
#include <string.h>
#include <stdlib.h>

void process(char *buf, int len) {
    if (!buf || len <= 0) return;
    memset(buf, 0, len);
}

int main(void) {
    char buf[BUFFER_SIZE];
    process(buf, BUFFER_SIZE);
    return 0;
}
