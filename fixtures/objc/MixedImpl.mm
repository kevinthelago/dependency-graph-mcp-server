/**
 * MixedImpl.mm — Obj-C++ implementation file.
 *
 * Tests:
 *   - .mm extension handled as best-effort objc
 *   - C++ headers mixed in (angled includes → external leaves)
 *   - @interface declaration in .mm file
 */

#import "Animal.h"
#include <vector>
#include <string>

@interface CppBridge : NSObject
- (instancetype)initWithCapacity:(NSUInteger)capacity;
@end

@implementation CppBridge {
    // Private C++ storage — not parsed at the symbol level
    void *_storage;
}

- (instancetype)initWithCapacity:(NSUInteger)capacity {
    if ((self = [super init])) {
        (void)capacity;
    }
    return self;
}

@end
