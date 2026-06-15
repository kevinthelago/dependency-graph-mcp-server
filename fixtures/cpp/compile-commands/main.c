#include "extra.h"
#include <stdio.h>

int helper(void) {
    return VERSION_MAJOR * 10 + VERSION_MINOR;
}

int main(void) {
    printf("version: %d\n", helper());
    return 0;
}
