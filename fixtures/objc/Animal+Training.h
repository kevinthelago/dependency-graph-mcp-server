/**
 * Animal+Training.h — category header.
 *
 * Tests:
 *   - @interface ClassName (Category)  → category symbol + category→class edge
 *   - #include with angled path         → external leaf
 */

#import "Animal.h"
#include <stdlib.h>

@interface Animal (Training)

- (void)trainWithDuration:(NSTimeInterval)seconds;
- (BOOL)isTrainable;

@end
